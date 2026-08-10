import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  ToastAndroid,
  useWindowDimensions,
  View
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import * as Speech from 'expo-speech';
import { StatusBar } from 'expo-status-bar';
import { LEVEL_DESCRIPTIONS, LEVEL_MIN_DIFFICULTY, LEVELS } from './src/data/levelWords';
import { cleanOcrTextWithGemini, enrichWordCandidates, extractWordCandidatesWithGemini } from './src/services/gemini';
import { createOcrImageSegments, joinOcrSegmentTexts, prepareImageForOcr } from './src/services/imageForOcr';
import { readTextFromImage } from './src/services/ocr';
import {
  DEFAULT_BOOK_TITLE,
  loadBookDetailSettings,
  loadFolders,
  loadLevel,
  loadWords,
  saveBookDetailSettings,
  saveFolders,
  saveLevel,
  saveWords
} from './src/services/storage';
import { buildWordCandidates, candidatesToWordEntries } from './src/services/wordProcessing';
import { BookFolder, Level, WordCandidate, WordEntry } from './src/types';

type ViewMode = 'home' | 'capture' | 'review' | 'bookDetail' | 'flashcards' | 'folderSettings';
type SortMode = 'latest' | 'oldest' | 'random' | 'az' | 'za';
type MemoryFilter = 'all' | 'unknown' | 'known';
type HideMode = 'none' | 'word' | 'meaning';
const ALL_WORDS_TITLE = '전체 단어';
const EXIT_TOAST_TIMEOUT = 2000;
const EXPORT_VERSION = 1;

const sortLabels: Record<SortMode, string> = {
  latest: '최신순',
  oldest: '오래된순',
  random: '랜덤',
  az: 'A-Z순',
  za: 'Z-A순'
};

export default function App() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const [mode, setMode] = useState<ViewMode>('home');
  const [level, setLevel] = useState<Level>('Level 1');
  const [words, setWords] = useState<WordEntry[]>([]);
  const [folders, setFolders] = useState<BookFolder[]>([]);
  const [activeFolderTitle, setActiveFolderTitle] = useState(DEFAULT_BOOK_TITLE);
  const [folderInput, setFolderInput] = useState(DEFAULT_BOOK_TITLE);
  const [candidates, setCandidates] = useState<WordCandidate[]>([]);
  const [imageUri, setImageUri] = useState<string>();
  const [ocrText, setOcrText] = useState('');
  const [isReading, setIsReading] = useState(false);
  const [isExtractingCandidates, setIsExtractingCandidates] = useState(false);
  const [isEnriching, setIsEnriching] = useState(false);
  const [selectedWordIds, setSelectedWordIds] = useState<Set<string>>(new Set());
  const [selectedFolderIds, setSelectedFolderIds] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>('latest');
  const [memoryFilter, setMemoryFilter] = useState<MemoryFilter>('all');
  const [hideMode, setHideMode] = useState<HideMode>('none');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [hasLoadedBookDetailSettings, setHasLoadedBookDetailSettings] = useState(false);
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [isMeaningVisible, setIsMeaningVisible] = useState(false);
  const [isLevelMenuOpen, setIsLevelMenuOpen] = useState(false);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [movingWordId, setMovingWordId] = useState<string | null>(null);
  const [folderModalValue, setFolderModalValue] = useState('새폴더');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [lastBackPressedAt, setLastBackPressedAt] = useState(0);

  useEffect(() => {
    const boot = async () => {
      const savedLevel = await loadLevel('Level 1');
      const savedWords = await loadWords();
      const savedFolders = await loadFolders(savedWords);
      const savedBookDetailSettings = await loadBookDetailSettings();
      setLevel(savedLevel);
      setWords(savedWords);
      setFolders(savedFolders);
      setActiveFolderTitle(savedFolders[0]?.title ?? DEFAULT_BOOK_TITLE);
      setFolderInput(savedFolders[0]?.title ?? DEFAULT_BOOK_TITLE);
      setSortMode(savedBookDetailSettings.sortMode);
      setMemoryFilter(savedBookDetailSettings.memoryFilter);
      setHideMode(savedBookDetailSettings.hideMode);
      setHasLoadedBookDetailSettings(true);
    };
    boot();
  }, []);

  useEffect(() => {
    if (!hasLoadedBookDetailSettings) {
      return;
    }
    saveBookDetailSettings({ sortMode, memoryFilter, hideMode });
  }, [hasLoadedBookDetailSettings, hideMode, memoryFilter, sortMode]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isLevelMenuOpen) {
        setIsLevelMenuOpen(false);
        return true;
      }
      if (isFolderModalOpen) {
        setIsFolderModalOpen(false);
        setRenamingFolderId(null);
        return true;
      }
      if (isFolderPickerOpen) {
        setIsFolderPickerOpen(false);
        return true;
      }
      if (movingWordId) {
        setMovingWordId(null);
        return true;
      }
      if (mode === 'flashcards') {
        setMode('bookDetail');
        setIsMeaningVisible(false);
        return true;
      }
      if (mode !== 'home') {
        setMode('home');
        setSelectedWordIds(new Set());
        setSelectedFolderIds(new Set());
        setIsMeaningVisible(false);
        return true;
      }

      const now = Date.now();
      if (now - lastBackPressedAt < EXIT_TOAST_TIMEOUT) {
        BackHandler.exitApp();
        return true;
      }

      setLastBackPressedAt(now);
      ToastAndroid.show('뒤로 가기 버튼을 한 번 더 누르면 종료됩니다.', ToastAndroid.SHORT);
      return true;
    });

    return () => subscription.remove();
  }, [isFolderModalOpen, isFolderPickerOpen, isLevelMenuOpen, lastBackPressedAt, mode, movingWordId]);

  const folderCounts = useMemo(() => {
    return words.reduce<Record<string, number>>((counts, word) => {
      const title = word.bookTitle?.trim() || DEFAULT_BOOK_TITLE;
      counts[title] = (counts[title] ?? 0) + 1;
      return counts;
    }, {});
  }, [words]);

  const totalWords = words.length;
  const knownWords = words.filter((word) => word.knownCount > 0).length;
  const unknownWords = totalWords - knownWords;
  const isAllWordsMode = activeFolderTitle === ALL_WORDS_TITLE;

  const activeWords = useMemo(() => {
    const filtered = words.filter(
      (word) =>
        (isAllWordsMode || (word.bookTitle?.trim() || DEFAULT_BOOK_TITLE) === activeFolderTitle) &&
        word.difficulty >= LEVEL_MIN_DIFFICULTY[level] &&
        (memoryFilter === 'all' || (memoryFilter === 'known' ? word.knownCount > 0 : word.knownCount === 0))
    );

    const copy = [...filtered];
    if (sortMode === 'latest') {
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    if (sortMode === 'oldest') {
      return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
    if (sortMode === 'az') {
      return copy.sort((a, b) => a.word.localeCompare(b.word));
    }
    if (sortMode === 'za') {
      return copy.sort((a, b) => b.word.localeCompare(a.word));
    }
    return copy.sort((a, b) => a.id.localeCompare(b.id)).sort(() => Math.random() - 0.5);
  }, [activeFolderTitle, isAllWordsMode, level, memoryFilter, sortMode, words]);

  const flashcardWords = useMemo(() => activeWords.filter((word) => word.knownCount === 0), [activeWords]);
  const currentCard = flashcardWords[flashcardIndex % Math.max(flashcardWords.length, 1)];
  const selectableCandidates = candidates.filter((candidate) => !candidate.isDuplicate);
  const selectedCandidateCount = selectableCandidates.filter((candidate) => candidate.selected).length;
  const duplicateCandidateCount = candidates.filter((candidate) => candidate.isDuplicate).length;

  const persistWords = async (nextWords: WordEntry[]) => {
    setWords(nextWords);
    await saveWords(nextWords);
  };

  const persistFolders = async (nextFolders: BookFolder[]) => {
    const ordered = nextFolders.map((folder, index) => ({ ...folder, order: index }));
    setFolders(ordered);
    await saveFolders(ordered);
  };

  const openAllWords = (filter: MemoryFilter) => {
    setActiveFolderTitle(ALL_WORDS_TITLE);
    setMemoryFilter(filter);
    setIsFilterOpen(false);
    setSelectedWordIds(new Set());
    setFlashcardIndex(0);
    setMode('bookDetail');
  };

  const resetBookDetailControls = () => {
    setIsFilterOpen(false);
  };

  const openAddFolderModal = () => {
    setRenamingFolderId(null);
    setFolderModalValue('새폴더');
    setIsFolderModalOpen(true);
  };

  const openRenameFolderModal = (folderId: string) => {
    const folder = folders.find((item) => item.id === folderId);
    if (!folder) {
      return;
    }
    setRenamingFolderId(folderId);
    setFolderModalValue(folder.title);
    setIsFolderModalOpen(true);
  };

  const submitFolderModal = async () => {
    const title = folderModalValue.trim();
    if (!title) {
      Alert.alert('이름이 필요해요', '단어장 이름을 입력해주세요.');
      return;
    }
    if (title.length > 20) {
      Alert.alert('이름이 너무 길어요', '단어장 이름은 20자까지 가능합니다.');
      return;
    }

    if (renamingFolderId) {
      const current = folders.find((folder) => folder.id === renamingFolderId);
      if (!current) {
        return;
      }
      if (folders.some((folder) => folder.id !== renamingFolderId && folder.title === title)) {
        Alert.alert('이미 있어요', '같은 이름의 단어장이 있습니다.');
        return;
      }
      await persistFolders(folders.map((folder) => (folder.id === renamingFolderId ? { ...folder, title } : folder)));
      await persistWords(words.map((word) => ((word.bookTitle || DEFAULT_BOOK_TITLE) === current.title ? { ...word, bookTitle: title } : word)));
      if (activeFolderTitle === current.title) {
        setActiveFolderTitle(title);
        setFolderInput(title);
      }
    } else {
      if (folders.some((folder) => folder.title === title)) {
        Alert.alert('이미 있어요', '같은 이름의 단어장이 있습니다.');
        return;
      }
      const nextFolder: BookFolder = {
        id: `folder-${Date.now()}`,
        title,
        createdAt: new Date().toISOString(),
        order: 0
      };
      await persistFolders([nextFolder, ...folders]);
      setActiveFolderTitle(title);
      setFolderInput(title);
    }

    setIsFolderModalOpen(false);
    setRenamingFolderId(null);
  };

  const moveFolder = async (folderId: string, direction: -1 | 1) => {
    const index = folders.findIndex((folder) => folder.id === folderId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= folders.length) {
      return;
    }
    const nextFolders = [...folders];
    const [folder] = nextFolders.splice(index, 1);
    nextFolders.splice(targetIndex, 0, folder);
    await persistFolders(nextFolders);
  };

  const deleteSelectedFolders = () => {
    const ids = new Set(selectedFolderIds);
    if (ids.size === 0) {
      return;
    }
    const titles = folders.filter((folder) => ids.has(folder.id)).map((folder) => folder.title);
    Alert.alert('선택 삭제', `선택한 ${ids.size}개 단어장과 안의 단어를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await persistFolders(folders.filter((folder) => !ids.has(folder.id)));
          await persistWords(words.filter((word) => !titles.includes(word.bookTitle || DEFAULT_BOOK_TITLE)));
          setSelectedFolderIds(new Set());
          if (titles.includes(activeFolderTitle)) {
            setActiveFolderTitle(DEFAULT_BOOK_TITLE);
          }
        }
      }
    ]);
  };

  const readTextFromBookImage = async (uri: string) => {
    const preparedImage = await prepareImageForOcr(uri);
    try {
      return await readTextFromImage(preparedImage.uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OCR_FAILED';
      if (message === 'OCR_API_KEY_MISSING') {
        throw error;
      }

      const segmentUris = await createOcrImageSegments(preparedImage);
      const segmentTexts: string[] = [];
      for (const segmentUri of segmentUris) {
        try {
          const segmentText = await readTextFromImage(segmentUri);
          if (segmentText.trim()) {
            segmentTexts.push(segmentText);
          }
        } catch {
          // Keep trying the remaining segments. A partial result is still useful for review.
        }
      }

      const joinedText = joinOcrSegmentTexts(segmentTexts);
      if (!joinedText.trim()) {
        throw error;
      }
      return joinedText;
    }
  };

  const pickImage = async (source: 'camera' | 'library') => {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('권한이 필요해요', '책 사진을 가져오려면 권한을 허용해주세요.');
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.85, allowsEditing: true })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.85, allowsEditing: true });
    if (result.canceled) {
      return;
    }

    const uri = result.assets[0].uri;
    setImageUri(uri);
    setIsReading(true);
    try {
      const text = await readTextFromBookImage(uri);
      try {
        const cleanedText = await cleanOcrTextWithGemini(text);
        setOcrText(cleanedText);
      } catch (cleanError) {
        setOcrText(text);
        const cleanMessage = cleanError instanceof Error ? cleanError.message : 'GEMINI_FAILED';
        if (cleanMessage !== 'GEMINI_API_KEY_MISSING' && cleanMessage !== 'AI_API_KEY_MISSING') {
          Alert.alert('AI 문장 정리 실패', 'OCR 원문을 표시합니다. 직접 수정한 뒤 진행할 수 있어요.');
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'OCR_FAILED';
      if (message === 'OCR_API_KEY_MISSING') {
        Alert.alert('OCR 키가 없어요', '.env의 OCR_SPACE_API_KEY를 설정하고 Expo 서버를 다시 시작해주세요.');
      } else {
        Alert.alert('글자 추출 실패', `${message}\n\n텍스트를 직접 수정한 뒤 진행할 수 있습니다.`);
      }
    } finally {
      setIsReading(false);
    }
  };

  const reviewExtractedWords = async () => {
    const targetFolder = folderInput.trim() || DEFAULT_BOOK_TITLE;
    setIsExtractingCandidates(true);
    try {
      const nextCandidates = await extractWordCandidatesWithGemini(
        ocrText,
        level,
        words.filter((word) => word.bookTitle === targetFolder).map((word) => word.word)
      );
      if (nextCandidates.length === 0) {
        Alert.alert('후보 단어가 없어요', `${level} 기준에 맞는 단어를 찾지 못했어요.`);
        return;
      }
      setCandidates(nextCandidates);
      setMode('review');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'GEMINI_FAILED';
      if (message === 'GEMINI_API_KEY_MISSING' || message === 'AI_API_KEY_MISSING') {
        setCandidates(
          buildWordCandidates(
            ocrText,
            level,
            words.filter((word) => word.bookTitle === targetFolder).map((word) => word.word)
          )
        );
        setMode('review');
        Alert.alert('AI 키가 없어요', '기본 단어 추출로 진행합니다.');
      } else {
        Alert.alert('AI 후보 추출 실패', message);
      }
    } finally {
      setIsExtractingCandidates(false);
    }
  };

  const toggleCandidate = (id: string) => {
    setCandidates((items) =>
      items.map((item) => (item.id === id && !item.isDuplicate ? { ...item, selected: !item.selected } : item))
    );
  };

  const setAllCandidates = (selected: boolean) => {
    setCandidates((items) => items.map((item) => (item.isDuplicate ? item : { ...item, selected })));
  };

  const saveSelectedCandidates = async () => {
    const title = folderInput.trim() || DEFAULT_BOOK_TITLE;
    const entries = candidatesToWordEntries(candidates, title);
    if (entries.length === 0) {
      Alert.alert('저장할 단어가 없어요', '선택된 새 단어가 없습니다.');
      return;
    }
    const existingFolder = folders.find((folder) => folder.title === title);
    if (existingFolder) {
      await persistFolders([existingFolder, ...folders.filter((folder) => folder.id !== existingFolder.id)]);
    } else {
      await persistFolders([
        { id: `folder-${Date.now()}`, title, createdAt: new Date().toISOString(), order: 0 },
        ...folders
      ]);
    }
    await persistWords([...entries, ...words]);
    setActiveFolderTitle(title);
    resetBookDetailControls();
    setCandidates([]);
    setMode('bookDetail');
    Alert.alert('저장 완료', `${entries.length}개 단어를 저장했어요.`);
  };

  const enrichSelectedCandidates = async () => {
    const targets = candidates.filter((candidate) => candidate.selected && !candidate.isDuplicate);
    if (targets.length === 0) {
      Alert.alert('보강할 단어가 없어요', '선택된 새 단어가 없습니다.');
      return;
    }
    setIsEnriching(true);
    try {
      const enrichedTargets = await enrichWordCandidates(
        targets,
        ocrText,
        words.map((word) => word.word)
      );
      const targetIds = new Set(targets.map((candidate) => candidate.id));
      setCandidates((items) => [...enrichedTargets, ...items.filter((item) => !targetIds.has(item.id))]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'GEMINI_FAILED';
      Alert.alert('AI 보강 실패', message);
    } finally {
      setIsEnriching(false);
    }
  };

  const deleteWord = (wordId: string) => {
    const target = words.find((word) => word.id === wordId);
    if (!target) {
      return;
    }
    Alert.alert('단어 삭제', `"${target.word}"을(를) 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await persistWords(words.filter((word) => word.id !== wordId));
          setSelectedWordIds((current) => {
            const next = new Set(current);
            next.delete(wordId);
            return next;
          });
          setFlashcardIndex(0);
        }
      }
    ]);
  };

  const deleteSelectedWords = () => {
    const ids = new Set(activeWords.filter((word) => selectedWordIds.has(word.id)).map((word) => word.id));
    if (ids.size === 0) {
      Alert.alert('삭제할 단어가 없어요', '삭제할 단어를 선택해주세요.');
      return;
    }
    Alert.alert('선택 단어 삭제', `선택한 ${ids.size}개 단어를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await persistWords(words.filter((word) => !ids.has(word.id)));
          setSelectedWordIds(new Set());
          setFlashcardIndex(0);
        }
      }
    ]);
  };

  const toggleKnown = async (wordId: string) => {
    await persistWords(
      words.map((word) =>
        word.id === wordId
          ? {
              ...word,
              reviewCount: word.reviewCount + 1,
              knownCount: word.knownCount > 0 ? 0 : 1
            }
          : word
      )
    );
  };

  const setKnown = async (wordId: string, known: boolean) => {
    await persistWords(
      words.map((word) =>
        word.id === wordId
          ? {
              ...word,
              reviewCount: word.reviewCount + 1,
              knownCount: known ? Math.max(word.knownCount, 1) : 0
            }
          : word
      )
    );
  };

  const moveWord = (wordId: string) => {
    if (folders.length <= 1) {
      Alert.alert('이동할 단어장이 없어요', '먼저 새 단어장을 만들어주세요.');
      return;
    }
    setMovingWordId(wordId);
  };

  const moveWordToFolder = async (folderTitle: string) => {
    if (!movingWordId) {
      return;
    }
    const targetFolder = folders.find((folder) => folder.title === folderTitle);
    await persistWords(words.map((word) => (word.id === movingWordId ? { ...word, bookTitle: folderTitle } : word)));
    if (targetFolder) {
      await persistFolders([targetFolder, ...folders.filter((folder) => folder.id !== targetFolder.id)]);
    }
    setMovingWordId(null);
  };

  const toggleWordSelection = (wordId: string) => {
    setSelectedWordIds((current) => {
      const next = new Set(current);
      if (next.has(wordId)) {
        next.delete(wordId);
      } else {
        next.add(wordId);
      }
      return next;
    });
  };

  const speak = (text: string) => {
    Speech.stop();
    Speech.speak(text, { language: 'en-US', rate: 0.85 });
  };

  const changeLevel = async (nextLevel: Level) => {
    setLevel(nextLevel);
    setFlashcardIndex(0);
    setIsLevelMenuOpen(false);
    await saveLevel(nextLevel);
  };

  const markCard = async (known: boolean) => {
    if (!currentCard) {
      return;
    }
    if (known) {
      await setKnown(currentCard.id, true);
      setFlashcardIndex((index) => (flashcardWords.length <= 1 ? 0 : index % (flashcardWords.length - 1)));
    } else {
      await persistWords(words.map((word) => (word.id === currentCard.id ? { ...word, reviewCount: word.reviewCount + 1 } : word)));
      setFlashcardIndex((index) => (index + 1) % Math.max(flashcardWords.length, 1));
    }
    setIsMeaningVisible(false);
  };

  const exportVocabulary = async () => {
    try {
      const payload = {
        app: 'WordSnap',
        version: EXPORT_VERSION,
        exportedAt: new Date().toISOString(),
        level,
        folders,
        words
      };
      const exportFile = new FileSystem.File(FileSystem.Paths.cache, `wordsnap-export-${Date.now()}.json`);
      exportFile.write(JSON.stringify(payload, null, 2));
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('내보내기 실패', '이 기기에서는 파일 공유를 사용할 수 없어요.');
        return;
      }
      await Sharing.shareAsync(exportFile.uri, {
        mimeType: 'application/json',
        dialogTitle: 'WordSnap 단어장 내보내기',
        UTI: 'public.json'
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'EXPORT_FAILED';
      Alert.alert('내보내기 실패', message);
    }
  };

  const importVocabulary = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true
      });
      if (result.canceled) {
        return;
      }

      const file = result.assets[0];
      const importFile = new FileSystem.File(file.uri);
      const raw = await importFile.text();
      const data = JSON.parse(raw) as { folders?: BookFolder[]; words?: WordEntry[]; level?: Level };
      if (!Array.isArray(data.words)) {
        Alert.alert('가져오기 실패', 'WordSnap 단어장 파일이 아니에요.');
        return;
      }

      const importedWords = data.words.map((word, index) => ({
        ...word,
        id: word.id || `imported-${Date.now()}-${index}`,
        bookTitle: word.bookTitle?.trim() || DEFAULT_BOOK_TITLE,
        createdAt: word.createdAt || new Date().toISOString(),
        reviewCount: word.reviewCount ?? 0,
        knownCount: word.knownCount ?? 0
      }));
      const existingKeys = new Set(words.map((word) => `${word.bookTitle || DEFAULT_BOOK_TITLE}::${word.word.toLowerCase()}`));
      const newWords = importedWords.filter((word) => !existingKeys.has(`${word.bookTitle || DEFAULT_BOOK_TITLE}::${word.word.toLowerCase()}`));

      const folderByTitle = new Map<string, BookFolder>();
      [...(data.folders ?? []), ...folders].forEach((folder) => {
        if (folder.title?.trim() && !folderByTitle.has(folder.title)) {
          folderByTitle.set(folder.title, folder);
        }
      });
      newWords.forEach((word) => {
        const title = word.bookTitle || DEFAULT_BOOK_TITLE;
        if (!folderByTitle.has(title)) {
          folderByTitle.set(title, {
            id: `folder-imported-${Date.now()}-${folderByTitle.size}`,
            title,
            createdAt: new Date().toISOString(),
            order: folderByTitle.size
          });
        }
      });

      await persistWords([...newWords, ...words]);
      await persistFolders(Array.from(folderByTitle.values()));
      if (data.level) {
        await changeLevel(data.level);
      }
      Alert.alert('가져오기 완료', `${newWords.length}개 단어를 가져왔어요.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'IMPORT_FAILED';
      Alert.alert('가져오기 실패', message);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <Header isTablet={isTablet} onMenu={() => setIsLevelMenuOpen(true)} onHome={() => setMode('home')} />
      {mode === 'home' && (
        <ScrollView contentContainerStyle={[styles.content, isTablet && styles.tabletContent]}>
          <View style={styles.statsRow}>
            <StatBox value={totalWords} label="전체" color="#3b82f6" onPress={() => openAllWords('all')} />
            <StatBox value={unknownWords} label="미암기" color="#fb5a67" onPress={() => openAllWords('unknown')} />
            <StatBox value={knownWords} label="암기" color="#22a018" onPress={() => openAllWords('known')} />
          </View>
          <View style={styles.fakeAd}>
            <Text style={styles.fakeAdText}>Word Snap</Text>
            <Text style={styles.fakeAdSub}>책에서 찾은 단어를 단어장으로 모아보세요.</Text>
          </View>
          <Pressable style={styles.primaryFullButton} onPress={() => setMode('capture')}>
            <Text style={styles.primaryButtonText}>책 사진으로 단어 추가</Text>
          </Pressable>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>단어장 목록</Text>
            <View style={styles.iconRow}>
              <Pressable onPress={openAddFolderModal}>
                <Text style={styles.headerIcon}>＋</Text>
              </Pressable>
              <Pressable onPress={() => setMode('folderSettings')}>
                <Text style={styles.headerIcon}>⚙</Text>
              </Pressable>
            </View>
          </View>
          <View style={[styles.folderList, isTablet && styles.tabletFolderList]}>
            {folders.map((folder) => (
              <Pressable
                key={folder.id}
                style={[styles.folderRow, isTablet && styles.tabletFolderRow]}
                onPress={() => {
                  setActiveFolderTitle(folder.title);
                  setFolderInput(folder.title);
                  resetBookDetailControls();
                  setSelectedWordIds(new Set());
                  setMode('bookDetail');
                }}
              >
                <Text style={styles.folderName}>{folder.title}</Text>
                <Text style={styles.folderCount}>{folderCounts[folder.title] ?? 0}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      {mode === 'folderSettings' && (
        <View style={styles.fullPanel}>
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>폴더 설정</Text>
            <Pressable style={styles.panelCloseButton} onPress={() => setMode('home')}>
              <Text style={styles.closeText}>×</Text>
            </Pressable>
          </View>
          <Pressable style={styles.addFolderRow} onPress={openAddFolderModal}>
            <Text style={styles.addFolderText}>＋ 새폴더 추가</Text>
          </Pressable>
          <View style={styles.importExportRow}>
            <Pressable style={styles.secondaryButton} onPress={exportVocabulary}>
              <Text style={styles.secondaryButtonText}>내보내기</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={importVocabulary}>
              <Text style={styles.secondaryButtonText}>가져오기</Text>
            </Pressable>
          </View>
          <ScrollView>
            {folders.map((folder, index) => (
              <View key={folder.id} style={styles.folderSettingRow}>
                <Pressable
                  style={[styles.circle, selectedFolderIds.has(folder.id) && styles.circleSelected]}
                  onPress={() =>
                    setSelectedFolderIds((current) => {
                      const next = new Set(current);
                      if (next.has(folder.id)) {
                        next.delete(folder.id);
                      } else {
                        next.add(folder.id);
                      }
                      return next;
                    })
                  }
                />
                <Text style={styles.folderName}>{folder.title}</Text>
                <Text style={styles.folderCount}>{folderCounts[folder.title] ?? 0}</Text>
                <Pressable onPress={() => openRenameFolderModal(folder.id)}>
                  <Text style={styles.lightIcon}>✎</Text>
                </Pressable>
                <View style={styles.reorderGroup}>
                  <Pressable onPress={() => moveFolder(folder.id, -1)} disabled={index === 0}>
                    <Text style={[styles.lightIcon, index === 0 && styles.disabledText]}>↑</Text>
                  </Pressable>
                  <Pressable onPress={() => moveFolder(folder.id, 1)} disabled={index === folders.length - 1}>
                    <Text style={[styles.lightIcon, index === folders.length - 1 && styles.disabledText]}>↓</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
          <Pressable
            style={[styles.bottomDeleteButton, selectedFolderIds.size === 0 && styles.disabledButton]}
            disabled={selectedFolderIds.size === 0}
            onPress={deleteSelectedFolders}
          >
            <Text style={styles.bottomDeleteText}>선택 삭제</Text>
          </Pressable>
        </View>
      )}

      {mode === 'capture' && (
        <ScrollView contentContainerStyle={[styles.content, isTablet && styles.tabletFormContent]}>
          <Text style={styles.sectionTitle}>책 사진 추가</Text>
          <Text style={styles.label}>단어장</Text>
          <Pressable style={styles.dropdownButton} onPress={() => setIsFolderPickerOpen(true)}>
            <Text style={styles.dropdownButtonText}>{folderInput}</Text>
            <Text style={styles.dropdownIcon}>⌄</Text>
          </Pressable>
          <View style={styles.actionRow}>
            <Pressable style={styles.primaryButton} onPress={() => pickImage('camera')}>
              <Text style={styles.primaryButtonText}>책 사진 찍기</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => pickImage('library')}>
              <Text style={styles.secondaryButtonText}>사진 선택</Text>
            </Pressable>
          </View>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.previewImage} />
          ) : (
            <View style={styles.emptyImage}>
              <Text style={styles.emptyText}>책 페이지 사진을 추가하세요</Text>
            </View>
          )}
          {isReading && <ActivityIndicator size="large" color="#12306b" />}
          <Text style={styles.label}>정리된 문장</Text>
          <TextInput
            value={ocrText}
            onChangeText={setOcrText}
            multiline
            placeholder="OCR 결과를 AI가 정리해서 여기에 표시합니다."
            style={styles.textArea}
            textAlignVertical="top"
          />
          <Pressable
            style={[styles.primaryFullButton, (!ocrText.trim() || isExtractingCandidates) && styles.disabledButton]}
            disabled={!ocrText.trim() || isExtractingCandidates}
            onPress={reviewExtractedWords}
          >
            <Text style={styles.primaryButtonText}>{isExtractingCandidates ? 'AI 후보 추출 중...' : 'AI 후보 단어 추출'}</Text>
          </Pressable>
        </ScrollView>
      )}

      {mode === 'review' && (
        <ScrollView contentContainerStyle={[styles.content, isTablet && styles.tabletContent]}>
          <Text style={styles.sectionTitle}>저장 전 검토</Text>
          <Text style={styles.summary}>선택 {selectedCandidateCount}개 · 중복 제외 {duplicateCandidateCount}개 · {folderInput}</Text>
          <View style={styles.actionRow}>
            <Pressable style={styles.secondaryButton} onPress={() => setAllCandidates(true)}>
              <Text style={styles.secondaryButtonText}>전체 선택</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => setAllCandidates(false)}>
              <Text style={styles.secondaryButtonText}>전체 해제</Text>
            </Pressable>
          </View>
          <View style={[styles.reviewGrid, isTablet && styles.tabletReviewGrid]}>
            {candidates.map((candidate) => (
              <Pressable
                key={candidate.id}
                style={[styles.wordItem, isTablet && styles.tabletReviewItem, candidate.selected && styles.wordItemSelected, candidate.isDuplicate && styles.faded]}
                onPress={() => toggleCandidate(candidate.id)}
              >
                <View style={styles.wordHeader}>
                  <Text style={styles.word}>{candidate.selected ? '✓ ' : ''}{candidate.word}</Text>
                  <Text style={styles.meaning}>{candidate.meaning}</Text>
                </View>
                <Text style={styles.meta}>
                  {candidate.level} · {candidate.entryType === 'phrase' ? '숙어/구문' : candidate.partOfSpeech || 'word'}
                  {candidate.isDuplicate ? ' · 이미 저장됨' : ''}
                </Text>
                {candidate.example ? <Text style={styles.example}>{candidate.example}</Text> : null}
              </Pressable>
            ))}
          </View>
          <Pressable
            style={[styles.primaryFullButton, selectedCandidateCount === 0 && styles.disabledButton]}
            disabled={selectedCandidateCount === 0}
            onPress={saveSelectedCandidates}
          >
            <Text style={styles.primaryButtonText}>선택 단어 저장</Text>
          </Pressable>
        </ScrollView>
      )}

      {mode === 'bookDetail' && (
        <ScrollView contentContainerStyle={[styles.detailContent, isTablet && styles.tabletDetailContent]}>
          <View style={styles.bookTitleRow}>
            <Text style={styles.bookTitle}>{activeFolderTitle} <Text style={styles.folderCount}>{activeWords.length}</Text></Text>
            <Pressable style={styles.flashcardButton} onPress={() => setMode('flashcards')}>
              <Text style={styles.flashcardButtonText}>플래시카드</Text>
            </Pressable>
          </View>
          <View style={styles.filterBar}>
            <Pressable style={styles.filterToggle} onPress={() => setIsFilterOpen((open) => !open)}>
              <Text style={styles.filterToggleText}>
                {sortLabels[sortMode]} · {memoryFilter === 'all' ? '전체' : memoryFilter === 'unknown' ? '미암기' : '암기'}
                {hideMode !== 'none' ? ` · ${hideMode === 'word' ? '단어 숨김' : '뜻 숨김'}` : ''}
              </Text>
              <Text style={styles.filterToggleIcon}>{isFilterOpen ? '⌃' : '⌄'}</Text>
            </Pressable>
            {isFilterOpen && (
              <>
                <OptionGroup
                  options={(['latest', 'oldest', 'random', 'az', 'za'] as SortMode[]).map((value) => ({ value, label: sortLabels[value] }))}
                  value={sortMode}
                  onChange={(value) => setSortMode(value as SortMode)}
                />
                <OptionGroup
                  options={[
                    { value: 'all', label: '전체' },
                    { value: 'unknown', label: '미암기' },
                    { value: 'known', label: '암기' }
                  ]}
                  value={memoryFilter}
                  onChange={(value) => setMemoryFilter(value as MemoryFilter)}
                />
                <OptionGroup
                  options={[
                    { value: 'word', label: '단어 숨김' },
                    { value: 'meaning', label: '뜻 숨김' }
                  ]}
                  value={hideMode}
                  onChange={(value) => setHideMode(hideMode === value ? 'none' : (value as HideMode))}
                />
              </>
            )}
          </View>
          <View style={[styles.detailWordGrid, isTablet && styles.tabletDetailWordGrid]}>
            {activeWords.map((word) => (
              <Pressable
                key={word.id}
                style={[styles.detailWordItem, isTablet && styles.tabletDetailWordItem]}
              >
                <View style={styles.wordHeader}>
                  <Text style={styles.detailWord}>{hideMode === 'word' ? '••••' : word.word}</Text>
                  <Pressable style={styles.speakerButton} onPress={() => speak(word.word)}>
                    <Text style={styles.speakerText}>▶</Text>
                  </Pressable>
                </View>
                {word.partOfSpeech ? <Text style={styles.meta}>{word.partOfSpeech}</Text> : null}
                {hideMode !== 'meaning' ? <Text style={styles.definition}>{word.meaning}</Text> : <Text style={styles.definition}>뜻 숨김</Text>}
                {word.example ? <Text style={styles.example}>{word.example}</Text> : null}
                <View style={styles.wordActions}>
                  <Pressable onPress={() => moveWord(word.id)}><Text style={styles.wordActionText}>이동</Text></Pressable>
                  <Pressable onPress={() => toggleKnown(word.id)}>
                    <Text style={word.knownCount > 0 ? styles.knownToggleText : styles.wordActionText}>
                      {word.knownCount > 0 ? '암기 완료' : '미암기'}
                    </Text>
                  </Pressable>
                  <Pressable onPress={() => deleteWord(word.id)}><Text style={styles.deleteText}>삭제</Text></Pressable>
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      {mode === 'flashcards' && (
        <View style={[styles.content, isTablet && styles.tabletFormContent]}>
          <Text style={styles.sectionTitle}>{activeFolderTitle} 플래시카드</Text>
          {currentCard ? (
            <View style={[styles.flashcard, isTablet && styles.tabletFlashcard]}>
              <Text style={styles.cardCount}>{flashcardIndex + 1} / {flashcardWords.length}</Text>
              <View style={styles.cardWordRow}>
                <Pressable style={styles.cardWordPressable} onPress={() => speak(currentCard.word)}>
                  <Text style={styles.cardWord}>{currentCard.word}</Text>
                </Pressable>
                <Pressable style={styles.speakerButton} onPress={() => speak(currentCard.word)}>
                  <Text style={styles.speakerText}>▶</Text>
                </Pressable>
              </View>
              <Pressable style={styles.meaningBox} onPress={() => setIsMeaningVisible((visible) => !visible)}>
                <Text style={styles.cardMeaning}>{isMeaningVisible ? currentCard.meaning : '뜻 보기'}</Text>
                {isMeaningVisible && currentCard.example ? <Text style={styles.cardExample}>{currentCard.example}</Text> : null}
              </Pressable>
              <View style={styles.actionRow}>
                <Pressable style={styles.secondaryButton} onPress={() => markCard(false)}>
                  <Text style={styles.secondaryButtonText}>몰라요</Text>
                </Pressable>
                <Pressable style={styles.primaryButton} onPress={() => markCard(true)}>
                  <Text style={styles.primaryButtonText}>알아요</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.emptyState}><Text style={styles.emptyStateText}>암기할 단어가 없어요.</Text></View>
          )}
        </View>
      )}

      <LevelMenu visible={isLevelMenuOpen} level={level} onClose={() => setIsLevelMenuOpen(false)} onSelect={changeLevel} />
      <FolderModal
        visible={isFolderModalOpen}
        value={folderModalValue}
        title={renamingFolderId ? '폴더 이름 변경' : '새폴더 추가'}
        onChange={(value) => setFolderModalValue(value.slice(0, 20))}
        onClear={() => setFolderModalValue('')}
        onCancel={() => setIsFolderModalOpen(false)}
        onConfirm={submitFolderModal}
      />
      <FolderPickerModal
        visible={isFolderPickerOpen}
        folders={folders}
        selectedTitle={folderInput}
        onClose={() => setIsFolderPickerOpen(false)}
        onSelect={(title) => {
          setFolderInput(title);
          setIsFolderPickerOpen(false);
        }}
      />
      <MoveWordModal
        visible={movingWordId !== null}
        folders={folders}
        currentTitle={words.find((word) => word.id === movingWordId)?.bookTitle || activeFolderTitle}
        onClose={() => setMovingWordId(null)}
        onSelect={moveWordToFolder}
      />
    </SafeAreaView>
  );
}

function Header({ isTablet, onMenu, onHome }: { isTablet: boolean; onMenu: () => void; onHome: () => void }) {
  return (
    <View style={styles.header}>
      <View style={[styles.headerInner, isTablet && styles.tabletHeaderInner]}>
        <View style={styles.headerBrand}>
          <Pressable style={styles.homeButton} onPress={onHome}>
            <Text style={styles.homeIcon}>⌂</Text>
          </Pressable>
          <Pressable onPress={onHome}>
            <Text style={styles.logo}>Word Snap</Text>
          </Pressable>
        </View>
        <Pressable onPress={onMenu}>
          <Text style={styles.menuIcon}>☰</Text>
        </Pressable>
      </View>
    </View>
  );
}

function StatBox({ value, label, color, onPress }: { value: number; label: string; color: string; onPress: () => void }) {
  return (
    <Pressable style={styles.statBox} onPress={onPress}>
      <View style={[styles.statDash, { backgroundColor: color }]} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={[styles.statLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

function OptionGroup({
  options,
  value,
  onChange
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionGroup}>
      {options.map((option) => (
        <Pressable key={option.value} style={[styles.optionChip, value === option.value && styles.optionChipActive]} onPress={() => onChange(option.value)}>
          <Text style={[styles.optionText, value === option.value && styles.optionTextActive]}>{option.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function LevelMenu({
  visible,
  level,
  onSelect,
  onClose
}: {
  visible: boolean;
  level: Level;
  onSelect: (level: Level) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <View style={styles.levelMenu}>
          {LEVELS.map((item) => (
            <Pressable key={item} style={[styles.levelItem, level === item && styles.levelItemActive]} onPress={() => onSelect(item)}>
              <Text style={styles.levelTitle}>{item}</Text>
              <Text style={styles.levelDescription}>{LEVEL_DESCRIPTIONS[item]}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

function FolderModal({
  visible,
  title,
  value,
  onChange,
  onClear,
  onCancel,
  onConfirm
}: {
  visible: boolean;
  title: string;
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalBackdrop}>
        <View style={styles.folderModal}>
          <Text style={styles.folderModalTitle}>{title}</Text>
          <View style={styles.folderInputWrap}>
            <TextInput value={value} onChangeText={onChange} style={styles.folderModalInput} autoFocus maxLength={20} />
            <Pressable style={styles.clearButton} onPress={onClear}>
              <Text style={styles.clearButtonText}>×</Text>
            </Pressable>
          </View>
          <Text style={styles.charCount}>{value.length}/20</Text>
          <View style={styles.modalButtonRow}>
            <Pressable style={styles.modalButton} onPress={onCancel}>
              <Text style={styles.modalCancelText}>취소</Text>
            </Pressable>
            <Pressable style={styles.modalButton} onPress={onConfirm}>
              <Text style={styles.modalConfirmText}>확인</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function FolderPickerModal({
  visible,
  folders,
  selectedTitle,
  onSelect,
  onClose
}: {
  visible: boolean;
  folders: BookFolder[];
  selectedTitle: string;
  onSelect: (title: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <View style={styles.pickerModal}>
          <Text style={styles.folderModalTitle}>단어장 선택</Text>
          {folders.map((folder) => (
            <Pressable key={folder.id} style={styles.pickerRow} onPress={() => onSelect(folder.title)}>
              <Text style={styles.pickerTitle}>{folder.title}</Text>
              <Text style={styles.pickerCheck}>{selectedTitle === folder.title ? '✓' : ''}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

function MoveWordModal({
  visible,
  folders,
  currentTitle,
  onSelect,
  onClose
}: {
  visible: boolean;
  folders: BookFolder[];
  currentTitle: string;
  onSelect: (title: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <View style={styles.pickerModal}>
          <Text style={styles.folderModalTitle}>단어장 이동</Text>
          <View style={styles.moveDropdownHeader}>
            <Text style={styles.dropdownButtonText}>{currentTitle}</Text>
            <Text style={styles.dropdownIcon}>⌄</Text>
          </View>
          {folders.map((folder) => {
            const isCurrent = folder.title === currentTitle;
            return (
              <Pressable
                key={folder.id}
                style={[styles.pickerRow, isCurrent && styles.disabledButton]}
                disabled={isCurrent}
                onPress={() => onSelect(folder.title)}
              >
                <Text style={styles.pickerTitle}>{folder.title}</Text>
                <Text style={styles.pickerCheck}>{isCurrent ? '현재' : ''}</Text>
              </Pressable>
            );
          })}
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#ffffff' },
  header: {
    minHeight: 116,
    backgroundColor: '#0f2864',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 28,
    paddingBottom: 18
  },
  headerInner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28
  },
  tabletHeaderInner: { maxWidth: 1080, paddingHorizontal: 36 },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  homeButton: { width: 42, height: 42, borderRadius: 21, borderWidth: 2, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  homeIcon: { color: '#ffffff', fontSize: 27, fontWeight: '900', lineHeight: 32 },
  logo: { color: '#ffffff', fontSize: 34, fontWeight: '900' },
  menuIcon: { color: '#ffffff', fontSize: 40, fontWeight: '300' },
  content: { padding: 20, gap: 16, paddingBottom: 48 },
  tabletContent: { width: '100%', maxWidth: 1080, alignSelf: 'center', paddingHorizontal: 32 },
  tabletFormContent: { width: '100%', maxWidth: 880, alignSelf: 'center', paddingHorizontal: 32 },
  detailContent: { paddingBottom: 48 },
  tabletDetailContent: { width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 16 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 36 },
  statBox: {
    width: '30%',
    aspectRatio: 0.95,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    paddingTop: 28,
    paddingBottom: 18
  },
  statDash: { width: 22, height: 4, borderRadius: 2, marginTop: 4, marginBottom: 8 },
  statValue: { fontSize: 38, fontWeight: '900', lineHeight: 44 },
  statLabel: { fontSize: 17, fontWeight: '800', marginTop: 14, marginBottom: 6 },
  fakeAd: { backgroundColor: '#f1f5f9', padding: 22, marginHorizontal: -20 },
  fakeAdText: { fontSize: 22, fontWeight: '900', color: '#172033' },
  fakeAdSub: { color: '#64748b', marginTop: 6, fontWeight: '700' },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 20 },
  listTitle: { fontSize: 24, fontWeight: '900', color: '#111827' },
  iconRow: { flexDirection: 'row', gap: 24, alignItems: 'center' },
  headerIcon: { fontSize: 36, color: '#94a3b8', fontWeight: '300' },
  folderList: { width: '100%' },
  tabletFolderList: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  folderRow: { flexDirection: 'row', alignItems: 'baseline', paddingVertical: 22, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tabletFolderRow: { width: '48.8%', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 18, backgroundColor: '#ffffff' },
  folderName: { fontSize: 24, color: '#2b2f36', fontWeight: '500' },
  folderCount: { fontSize: 16, color: '#9ca3af', marginLeft: 8, fontWeight: '700' },
  primaryFullButton: { minHeight: 52, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f6feb', paddingHorizontal: 14 },
  sectionTitle: { fontSize: 24, fontWeight: '900', color: '#172033' },
  label: { color: '#334155', fontWeight: '800' },
  singleLineInput: {
    minHeight: 50,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#172033'
  },
  dropdownButton: {
    minHeight: 58,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  dropdownButtonText: { color: '#172033', fontSize: 20, fontWeight: '800', flex: 1 },
  dropdownIcon: { color: '#64748b', fontSize: 28, fontWeight: '900', marginLeft: 12 },
  actionRow: { flexDirection: 'row', gap: 10 },
  primaryButton: { flex: 1, minHeight: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1f6feb', paddingHorizontal: 14 },
  primaryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  secondaryButton: { flex: 1, minHeight: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#dbeafe', paddingHorizontal: 14 },
  secondaryButtonText: { color: '#1e40af', fontSize: 16, fontWeight: '800' },
  dangerButton: { minHeight: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#dc2626', paddingHorizontal: 14, marginHorizontal: 20 },
  dangerButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  disabledButton: { opacity: 0.35 },
  previewImage: { width: '100%', height: 240, borderRadius: 8, backgroundColor: '#e2e8f0' },
  emptyImage: { height: 220, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e2e8f0' },
  emptyText: { color: '#64748b', fontWeight: '700' },
  textArea: {
    minHeight: 160,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    padding: 14,
    fontSize: 16,
    color: '#172033',
    lineHeight: 22
  },
  summary: { color: '#64748b', fontWeight: '700' },
  reviewGrid: { gap: 16 },
  tabletReviewGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch' },
  wordItem: { borderRadius: 8, backgroundColor: '#ffffff', padding: 16, gap: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  tabletReviewItem: { width: '48.8%' },
  wordItemSelected: { borderColor: '#1f6feb', backgroundColor: '#eff6ff' },
  faded: { opacity: 0.55 },
  wordHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  word: { fontSize: 22, fontWeight: '900', color: '#111827', flex: 1 },
  meaning: { flex: 1, textAlign: 'right', color: '#1f6feb', fontSize: 16, fontWeight: '800' },
  meta: { color: '#94a3b8', fontSize: 13, fontWeight: '800' },
  example: { color: '#172033', lineHeight: 20, fontStyle: 'italic' },
  fullPanel: { flex: 1, backgroundColor: '#ffffff' },
  panelHeader: { height: 72, backgroundColor: '#0f2864', alignItems: 'center', justifyContent: 'center' },
  panelTitle: { color: '#ffffff', fontSize: 24, fontWeight: '900' },
  panelCloseButton: { position: 'absolute', right: 22, top: 8, width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#ffffff', fontSize: 46, fontWeight: '200' },
  addFolderRow: { height: 72, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  addFolderText: { color: '#8b8f98', fontSize: 22, fontWeight: '700' },
  importExportRow: { flexDirection: 'row', gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  folderSettingRow: { minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  circle: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: '#e5e7eb' },
  circleSelected: { backgroundColor: '#1f6feb', borderColor: '#1f6feb' },
  lightIcon: { fontSize: 28, color: '#c8ccd3', paddingHorizontal: 6 },
  reorderGroup: { flexDirection: 'row', marginLeft: 'auto' },
  disabledText: { opacity: 0.25 },
  bottomDeleteButton: { minHeight: 64, borderTopWidth: 1, borderColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  bottomDeleteText: { color: '#8b8f98', fontSize: 20, fontWeight: '800' },
  bookTitleRow: { minHeight: 88, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, borderBottomWidth: 1, borderColor: '#e5e7eb' },
  bookTitle: { fontSize: 26, color: '#111827', fontWeight: '600' },
  flashcardButton: { backgroundColor: '#7288ff', borderRadius: 6, minHeight: 52, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  flashcardButtonText: { color: '#ffffff', fontWeight: '900', fontSize: 16 },
  filterBar: { backgroundColor: '#f1f3f6', paddingVertical: 10, gap: 8 },
  filterToggle: {
    minHeight: 44,
    marginHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14
  },
  filterToggleText: { color: '#111827', fontSize: 16, fontWeight: '900', flex: 1 },
  filterToggleIcon: { color: '#64748b', fontSize: 24, fontWeight: '900', marginLeft: 10 },
  optionGroup: { gap: 8, paddingHorizontal: 14 },
  optionChip: { minHeight: 34, borderRadius: 8, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  optionChipActive: { backgroundColor: '#ffffff' },
  optionText: { color: '#6b7280', fontWeight: '800' },
  optionTextActive: { color: '#111827' },
  detailWordGrid: { width: '100%' },
  tabletDetailWordGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, paddingVertical: 16 },
  detailWordItem: { padding: 20, gap: 12, borderBottomWidth: 1, borderBottomColor: '#e5e7eb', backgroundColor: '#ffffff' },
  tabletDetailWordItem: { width: '48.8%', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8 },
  detailWord: { fontSize: 40, color: '#000000', fontWeight: '500', flex: 1 },
  speakerButton: { width: 54, height: 54, borderRadius: 27, backgroundColor: '#0f2864', alignItems: 'center', justifyContent: 'center' },
  speakerText: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  definition: { backgroundColor: '#f8fafc', padding: 16, fontSize: 18, color: '#111827', lineHeight: 28 },
  wordActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 28 },
  wordActionText: { color: '#9ca3af', fontSize: 16, fontWeight: '800' },
  knownToggleText: { color: '#1f6feb', fontSize: 16, fontWeight: '900' },
  deleteText: { color: '#dc2626', fontSize: 16, fontWeight: '800' },
  emptyState: { minHeight: 180, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0' },
  emptyStateText: { color: '#64748b', fontWeight: '700' },
  flashcard: { minHeight: 380, borderRadius: 8, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', padding: 20, justifyContent: 'space-between', gap: 18 },
  tabletFlashcard: { minHeight: 460, maxWidth: 720, width: '100%', alignSelf: 'center', padding: 32 },
  cardCount: { color: '#64748b', fontWeight: '800' },
  cardWord: { textAlign: 'center', color: '#172033', fontSize: 42, fontWeight: '900' },
  cardWordRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14 },
  cardWordPressable: { flexShrink: 1 },
  meaningBox: { minHeight: 96, borderRadius: 8, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center', padding: 16 },
  cardMeaning: { color: '#1f6feb', fontSize: 24, fontWeight: '900', textAlign: 'center' },
  cardExample: { color: '#475569', fontSize: 14, fontWeight: '600', lineHeight: 20, marginTop: 10, textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  levelMenu: { width: '90%', backgroundColor: '#ffffff', borderRadius: 8, padding: 12 },
  levelItem: { padding: 14, borderRadius: 8 },
  levelItemActive: { backgroundColor: '#dbeafe' },
  levelTitle: { fontSize: 18, fontWeight: '900', color: '#111827' },
  levelDescription: { color: '#64748b', marginTop: 4 },
  folderModal: { width: '100%', backgroundColor: '#ffffff', paddingTop: 28 },
  pickerModal: { width: '100%', maxHeight: '70%', backgroundColor: '#ffffff', borderRadius: 8, paddingTop: 24, paddingBottom: 12 },
  pickerRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  pickerTitle: { color: '#172033', fontSize: 20, fontWeight: '800', flex: 1 },
  pickerCheck: { color: '#1f6feb', fontSize: 24, fontWeight: '900', marginLeft: 12 },
  moveDropdownHeader: {
    minHeight: 58,
    marginHorizontal: 24,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  folderModalTitle: { textAlign: 'center', fontSize: 24, fontWeight: '900', marginBottom: 24 },
  folderInputWrap: { marginHorizontal: 28, borderWidth: 1, borderColor: '#e5e7eb', padding: 8, flexDirection: 'row', alignItems: 'center' },
  folderModalInput: { flex: 1, minHeight: 44, borderWidth: 2, borderColor: '#f59e0b', borderRadius: 6, paddingHorizontal: 8, fontSize: 20 },
  clearButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#d1d5db', alignItems: 'center', justifyContent: 'center', marginLeft: 10 },
  clearButtonText: { color: '#ffffff', fontSize: 30, lineHeight: 32 },
  charCount: { alignSelf: 'flex-end', marginRight: 44, marginTop: 14, color: '#8b8f98', fontSize: 18, fontWeight: '700' },
  modalButtonRow: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#e5e7eb', marginTop: 28 },
  modalButton: { flex: 1, minHeight: 64, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderColor: '#e5e7eb' },
  modalCancelText: { fontSize: 20, color: '#111827', fontWeight: '800' },
  modalConfirmText: { fontSize: 20, color: '#0f2864', fontWeight: '900' }
});

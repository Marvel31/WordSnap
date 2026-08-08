import AsyncStorage from '@react-native-async-storage/async-storage';
import { BookFolder, Level, WordEntry } from '../types';
import { LEVELS } from '../data/levelWords';

const WORDS_KEY = 'wordsnap.words';
const LEVEL_KEY = 'wordsnap.level';
const FOLDERS_KEY = 'wordsnap.folders';
const LEGACY_GRADE_KEY = 'wordsnap.grade';

export const DEFAULT_BOOK_TITLE = '기본 단어장';

const isLevel = (value: unknown): value is Level => typeof value === 'string' && LEVELS.includes(value as Level);

const normalizeStoredWord = (word: WordEntry & { grade?: unknown }) => ({
  ...word,
  bookTitle: word.bookTitle?.trim() || DEFAULT_BOOK_TITLE,
  level: isLevel(word.level) ? word.level : 'Level 1',
  difficulty: word.difficulty ?? 1,
  originalText: word.originalText,
  partOfSpeech: word.partOfSpeech,
  example: word.example,
  entryType: word.entryType ?? 'word'
});

export const loadWords = async () => {
  const raw = await AsyncStorage.getItem(WORDS_KEY);
  const parsed = raw ? (JSON.parse(raw) as Array<WordEntry & { grade?: unknown }>) : [];
  return parsed.map(normalizeStoredWord);
};

export const saveWords = async (words: WordEntry[]) => {
  await AsyncStorage.setItem(WORDS_KEY, JSON.stringify(words));
};

export const loadLevel = async (fallback: Level) => {
  const raw = await AsyncStorage.getItem(LEVEL_KEY);
  return isLevel(raw) ? raw : fallback;
};

export const saveLevel = async (level: Level) => {
  await AsyncStorage.setItem(LEVEL_KEY, level);
  await AsyncStorage.removeItem(LEGACY_GRADE_KEY);
};

export const buildFoldersFromWords = (words: WordEntry[]) => {
  const titles = Array.from(new Set(words.map((word) => word.bookTitle?.trim() || DEFAULT_BOOK_TITLE)));
  if (titles.length === 0) {
    titles.push(DEFAULT_BOOK_TITLE);
  }
  return titles.map<BookFolder>((title, index) => ({
    id: `folder-${title.toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-') || index}`,
    title,
    createdAt: new Date().toISOString(),
    order: index
  }));
};

export const loadFolders = async (words: WordEntry[]) => {
  const raw = await AsyncStorage.getItem(FOLDERS_KEY);
  if (!raw) {
    return buildFoldersFromWords(words);
  }

  const parsed = JSON.parse(raw) as BookFolder[];
  const knownTitles = new Set(parsed.map((folder) => folder.title));
  const missing = buildFoldersFromWords(words).filter((folder) => !knownTitles.has(folder.title));
  return [...parsed, ...missing].sort((a, b) => a.order - b.order);
};

export const saveFolders = async (folders: BookFolder[]) => {
  await AsyncStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
};

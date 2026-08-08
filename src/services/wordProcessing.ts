import { LEVEL_MIN_DIFFICULTY, WORD_DICTIONARY, STOP_WORDS } from '../data/levelWords';
import { Level, WordCandidate, WordEntry } from '../types';

const toLevel = (difficulty: number): Level => {
  if (difficulty >= 5) {
    return 'Level 5';
  }
  if (difficulty >= 4) {
    return 'Level 4';
  }
  if (difficulty >= 3) {
    return 'Level 3';
  }
  if (difficulty >= 2) {
    return 'Level 2';
  }
  return 'Level 1';
};

const normalizeWord = (raw: string) => {
  const word = raw.toLowerCase().replace(/[^a-z']/g, '').replace(/^'+|'+$/g, '');
  if (WORD_DICTIONARY[word]) {
    return word;
  }
  if (word.endsWith('ies') && word.length > 4) {
    return `${word.slice(0, -3)}y`;
  }
  if (word.endsWith('ing') && word.length > 5) {
    const stem = word.slice(0, -3);
    return WORD_DICTIONARY[stem] ? stem : word;
  }
  if (word.endsWith('ed') && word.length > 4) {
    const stem = word.slice(0, -2);
    return WORD_DICTIONARY[stem] ? stem : word;
  }
  if (word.endsWith('s') && word.length > 3) {
    return word.slice(0, -1);
  }
  return word;
};

export const cleanOcrText = (text: string) =>
  text
    .replace(/([A-Za-z])-\s*\n\s*([A-Za-z])/g, '$1$2')
    .replace(/([A-Za-z])-\s+([A-Za-z])/g, '$1$2');

export const buildWordCandidates = (text: string, selectedLevel: Level, existingWords: string[]): WordCandidate[] => {
  const cleanedText = cleanOcrText(text);
  const minDifficulty = LEVEL_MIN_DIFFICULTY[selectedLevel];
  const isBroadLevel = selectedLevel === 'Level 1';
  const existing = new Set(existingWords.map((word) => word.toLowerCase()));
  const seen = new Set<string>();
  const sentences = cleanedText.split(/(?<=[.!?])\s+/);
  const tokens = cleanedText.match(/[A-Za-z']+/g) ?? [];

  return tokens.reduce<WordCandidate[]>((candidates, token) => {
    const word = normalizeWord(token);
    if (!word || word.length < 2 || seen.has(word)) {
      return candidates;
    }

    if (!isBroadLevel && STOP_WORDS.has(word)) {
      return candidates;
    }

    const dictionaryEntry = WORD_DICTIONARY[word];
    const difficulty = dictionaryEntry?.difficulty ?? 1;
    if (difficulty < minDifficulty) {
      return candidates;
    }

    seen.add(word);
    const isDuplicate = existing.has(word);
    candidates.push({
      id: `${word}-${candidates.length}`,
      word,
      originalText: token,
      meaning: dictionaryEntry?.meaning ?? '뜻 추가 필요',
      partOfSpeech: undefined,
      example: undefined,
      entryType: 'word',
      difficulty,
      level: toLevel(difficulty),
      sourceSentence: sentences.find((sentence) => new RegExp(`\\b${token}\\b`, 'i').test(sentence))?.trim(),
      isDuplicate,
      selected: !isDuplicate
    });
    return candidates;
  }, []);
};

export const candidatesToWordEntries = (candidates: WordCandidate[], bookTitle: string): WordEntry[] =>
  candidates
    .filter((candidate) => candidate.selected && !candidate.isDuplicate)
    .map((candidate, index) => ({
      id: `${candidate.word}-${Date.now()}-${index}`,
      word: candidate.word,
      bookTitle,
      originalText: candidate.originalText,
      meaning: candidate.meaning,
      partOfSpeech: candidate.partOfSpeech,
      example: candidate.example,
      entryType: candidate.entryType,
      level: candidate.level,
      difficulty: candidate.difficulty,
      sourceSentence: candidate.sourceSentence,
      createdAt: new Date().toISOString(),
      reviewCount: 0,
      knownCount: 0
    }));

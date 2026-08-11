export type Level = 'Level 1' | 'Level 2' | 'Level 3' | 'Level 4' | 'Level 5';

export type BookFolder = {
  id: string;
  title: string;
  createdAt: string;
  order: number;
};

export type WordEntry = {
  id: string;
  word: string;
  bookTitle: string;
  originalText?: string;
  meaning: string;
  partOfSpeech?: string;
  example?: string;
  entryType?: 'word' | 'phrase';
  level: Level;
  difficulty: number;
  sourceSentence?: string;
  createdAt: string;
  reviewCount: number;
  knownCount: number;
  isFavorite?: boolean;
};

export type WordCandidate = {
  id: string;
  word: string;
  originalText?: string;
  meaning: string;
  partOfSpeech?: string;
  example?: string;
  entryType?: 'word' | 'phrase';
  level: Level;
  difficulty: number;
  sourceSentence?: string;
  isDuplicate: boolean;
  selected: boolean;
};

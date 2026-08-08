import Constants from 'expo-constants';
import { LEVEL_MIN_DIFFICULTY } from '../data/levelWords';
import { Level, WordCandidate } from '../types';

type GeminiVocabularyItem = {
  term: string;
  sourceWords?: string[];
  originalText?: string;
  meaning: string;
  partOfSpeech: string;
  example: string;
  difficulty: number;
  entryType?: 'word' | 'phrase';
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

const clampDifficulty = (value: unknown) => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 1;
  }
  return Math.min(5, Math.max(1, Math.round(numeric)));
};

const difficultyToLevel = (difficulty: number): Level => {
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

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z\s-]/g, '').replace(/\s+/g, ' ').trim();

const parseJsonArray = (text: string) => {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  const json = start >= 0 && end >= start ? trimmed.slice(start, end + 1) : trimmed;
  return JSON.parse(json) as GeminiVocabularyItem[];
};

const buildSchema = () => ({
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      term: { type: 'STRING' },
      sourceWords: {
        type: 'ARRAY',
        items: { type: 'STRING' }
      },
      originalText: { type: 'STRING' },
      meaning: { type: 'STRING' },
      partOfSpeech: { type: 'STRING' },
      example: { type: 'STRING' },
      difficulty: { type: 'INTEGER' },
      entryType: { type: 'STRING' }
    },
    required: ['term', 'sourceWords', 'originalText', 'meaning', 'partOfSpeech', 'example', 'difficulty', 'entryType'],
    propertyOrdering: ['term', 'sourceWords', 'originalText', 'meaning', 'partOfSpeech', 'example', 'difficulty', 'entryType']
  }
});

const requestVocabularyItems = async (prompt: string) => {
  const apiKey = Constants.expoConfig?.extra?.geminiApiKey as string | undefined;
  const model = (Constants.expoConfig?.extra?.geminiModel as string | undefined) ?? 'gemini-3.5-flash';

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY_MISSING');
  }

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: buildSchema()
    }
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(requestBody)
  });

  let data = (await response.json()) as GeminiResponse;
  let text = data.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join('').trim();

  if (!response.ok && data.error?.message?.includes('responseSchema')) {
    const fallbackResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        ...requestBody,
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      })
    });
    data = (await fallbackResponse.json()) as GeminiResponse;
    text = data.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join('').trim();
    if (!fallbackResponse.ok || !text) {
      throw new Error(data.error?.message || 'GEMINI_FAILED');
    }
  } else if (!response.ok || !text) {
    throw new Error(data.error?.message || 'GEMINI_FAILED');
  }

  return parseJsonArray(text);
};

const findSourceSentence = (ocrText: string, term: string, sourceWords: string[]) => {
  const sentences = ocrText.split(/(?<=[.!?])\s+/);
  const terms = [term, ...sourceWords].map((item) => item.trim()).filter(Boolean);
  return sentences.find((sentence) => terms.some((item) => sentence.toLowerCase().includes(item.toLowerCase())))?.trim();
};

const toCandidates = (items: GeminiVocabularyItem[], ocrText: string, existingWords: string[], sourceCandidates: WordCandidate[] = []) => {
  const existing = new Set(existingWords.map(normalizeKey));
  const existingExact = new Set(existingWords.map((word) => word.toLowerCase()));
  const sourceByWord = new Map(sourceCandidates.map((candidate) => [normalizeKey(candidate.word), candidate]));
  const seen = new Set<string>();

  return items.reduce<WordCandidate[]>((nextCandidates, item, index) => {
    const term = item.term?.trim();
    if (!term) {
      return nextCandidates;
    }

    const key = normalizeKey(term);
    if (!key || seen.has(key)) {
      return nextCandidates;
    }

    const sourceWords = item.sourceWords?.filter(Boolean) ?? [];
    const firstSource = sourceWords.map(normalizeKey).map((word) => sourceByWord.get(word)).find(Boolean);
    const difficulty = clampDifficulty(item.difficulty);
    const isDuplicate = existing.has(key) || existingExact.has(term.toLowerCase());
    seen.add(key);

    nextCandidates.push({
      id: `ai-${key}-${Date.now()}-${index}`,
      word: term,
      originalText: item.originalText || sourceWords.join(', ') || firstSource?.originalText || term,
      meaning: item.meaning || firstSource?.meaning || '뜻 추가 필요',
      partOfSpeech: item.partOfSpeech || firstSource?.partOfSpeech,
      example: item.example || firstSource?.example,
      entryType: item.entryType === 'phrase' ? 'phrase' : 'word',
      difficulty,
      level: difficultyToLevel(difficulty),
      sourceSentence: firstSource?.sourceSentence || findSourceSentence(ocrText, term, sourceWords),
      isDuplicate,
      selected: !isDuplicate
    });
    return nextCandidates;
  }, []);
};

export const extractWordCandidatesWithGemini = async (ocrText: string, selectedLevel: Level, existingWords: string[]) => {
  const minDifficulty = LEVEL_MIN_DIFFICULTY[selectedLevel];
  const prompt = [
    'You are extracting vocabulary candidates from OCR text for a Korean English-learning app.',
    'Return only useful vocabulary entries as JSON array. Do not wrap in markdown.',
    'Rules:',
    `1. User selected ${selectedLevel}. Return only entries with difficulty >= ${minDifficulty}.`,
    '2. Correct OCR errors and broken fragments using context. Example: "Pennsylva- nia" or "pennsylva" + "nia" should become "Pennsylvania".',
    '3. Do not return meaningless OCR fragments such as "nia" when they are part of a broken word.',
    '4. Save dictionary headwords. Example: "climbed" -> "climb", "found" -> "find", "appeared" -> "appear".',
    '5. If a phrase, idiom, phrasal verb, or fixed expression is better to memorize together, return it as one phrase entry.',
    '6. Exclude common stop words and proper nouns unless useful for understanding the text.',
    '7. Use concise Korean meanings, English part of speech, simple English example sentences, and difficulty 1-5.',
    '8. entryType must be "word" or "phrase". sourceWords must list OCR words/fragments used for the entry.',
    `Existing saved terms to mark as duplicates: ${existingWords.join(', ') || '(none)'}`,
    `OCR source text:\n${ocrText}`
  ].join('\n');

  const items = await requestVocabularyItems(prompt);
  return toCandidates(items, ocrText, existingWords).filter((candidate) => candidate.difficulty >= minDifficulty);
};

export const enrichWordCandidates = async (candidates: WordCandidate[], ocrText: string, existingWords: string[]) => {
  const candidateWords = candidates.map((candidate) => candidate.word);
  const prompt = [
    'You are cleaning OCR vocabulary candidates for a Korean English-learning app.',
    'Use the OCR source text to correct broken OCR fragments and save dictionary headwords.',
    'Rules:',
    '1. Return only useful vocabulary entries as JSON array. Do not wrap in markdown.',
    '2. Correct OCR fragments such as "pennsylva" + "nia" to "Pennsylvania"; do not return meaningless fragments like "nia".',
    '3. Restore missing letters when the source clearly shows a word, such as "mysteriou" to "mysterious".',
    '4. Save inflected verbs as base forms, such as "climbed" to "climb" and "found" to "find".',
    '5. If a phrase, idiom, phrasal verb, or fixed expression is better to memorize together, return it as one phrase entry.',
    '6. Exclude proper nouns unless they are useful for understanding the text.',
    '7. Use concise Korean meanings, English part of speech, simple English example sentences, and difficulty 1-5.',
    '8. entryType must be "word" or "phrase". sourceWords must list the OCR candidate words that produced the entry.',
    `Existing saved terms to mark as duplicates: ${existingWords.join(', ') || '(none)'}`,
    `OCR source text:\n${ocrText}`,
    `Selected OCR candidate words:\n${candidateWords.join(', ')}`
  ].join('\n');

  const items = await requestVocabularyItems(prompt);
  return toCandidates(items, ocrText, existingWords, candidates);
};

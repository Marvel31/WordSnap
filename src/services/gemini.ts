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

type GroqResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
  failed_generation?: string;
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

const LEVEL_EXTRACTION_GUIDANCE: Record<Level, string[]> = {
  'Level 1': [
    '1. User selected Level 1. Extract broadly: include most readable content words and useful phrases from the text.',
    '   Include simple nouns, verbs, adjectives, adverbs, phrasal verbs, and expressions even when difficulty is 1.',
    '   Exclude only low-value grammar/function words by themselves, such as articles, pronouns, auxiliary verbs, conjunctions, and prepositions, unless they are part of a phrase.',
    '   For a normal book page, prefer returning many candidates rather than being selective.'
  ],
  'Level 2': [
    '1. User selected Level 2. Return entries with difficulty 2-5.',
    '   Target upper elementary level and above: common but useful story words, basic academic words, everyday phrasal verbs, and simple expressions.',
    '   Skip very basic Level 1 words such as book, day, go, make, good, big, unless they form a useful phrase.'
  ],
  'Level 3': [
    '1. User selected Level 3. Return entries with difficulty 3-5.',
    '   Target middle school level and above: less basic verbs/adjectives, abstract nouns, story vocabulary, and useful idioms or fixed expressions.',
    '   Skip ordinary elementary words unless the phrase itself is worth memorizing.'
  ],
  'Level 4': [
    '1. User selected Level 4. Return entries with difficulty 4-5.',
    '   Target high school level and above: academic words, abstract words, nuanced verbs/adjectives, and harder expressions.',
    '   Be selective; do not include common middle-school words.'
  ],
  'Level 5': [
    '1. User selected Level 5. Return only difficulty 5 entries.',
    '   Target advanced high school senior, CSAT-style, or college-prep vocabulary: rare, abstract, academic, literary, or high-value advanced expressions.',
    '   Be very selective and return fewer entries.'
  ]
};

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z\s-]/g, '').replace(/\s+/g, ' ').trim();

const parseJsonArray = (text: string) => {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start >= 0 && end >= start) {
    return JSON.parse(trimmed.slice(start, end + 1)) as GeminiVocabularyItem[];
  }
  const parsed = JSON.parse(trimmed) as GeminiVocabularyItem[] | { items?: GeminiVocabularyItem[] };
  return Array.isArray(parsed) ? parsed : parsed.items ?? [];
};

const stripCodeBlock = (text: string) =>
  text.trim().replace(/^```(?:text)?\s*/i, '').replace(/```$/i, '').trim();

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

const requestGeminiText = async (prompt: string, generationConfig: Record<string, unknown>) => {
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
    generationConfig
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

  return text;
};

const extractGroqText = (data: GroqResponse) => data.choices?.[0]?.message?.content?.trim();

const postGroqChat = async (apiKey: string, model: string, prompt: string, jsonMode = false) => {
  const content = jsonMode
    ? [
        prompt,
        '',
        'Return JSON only. Do not include markdown, comments, or explanations.',
        'Use this exact top-level shape:',
        '{"items":[{"term":"","sourceWords":[],"originalText":"","meaning":"","partOfSpeech":"","example":"","difficulty":1,"entryType":"word"}]}'
      ].join('\n')
    : prompt;

  return fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content
        }
      ],
      temperature: jsonMode ? 0.1 : 0,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
    })
  });
};

const requestGroqText = async (prompt: string, jsonMode = false) => {
  const apiKey = Constants.expoConfig?.extra?.groqApiKey as string | undefined;
  const model = (Constants.expoConfig?.extra?.groqModel as string | undefined) ?? 'openai/gpt-oss-20b';

  if (!apiKey) {
    throw new Error('GROQ_API_KEY_MISSING');
  }

  const response = await postGroqChat(apiKey, model, prompt, jsonMode);
  const data = (await response.json()) as GroqResponse;
  const text = extractGroqText(data);

  if (response.ok && text) {
    return text;
  }

  const errorMessage = data.error?.message || 'GROQ_FAILED';
  if (jsonMode && errorMessage.toLowerCase().includes('json')) {
    const retryPrompt = [
      prompt,
      '',
      'Return only a valid JSON object with an "items" array.',
      'No markdown. No explanation. No trailing commas.'
    ].join('\n');
    const retryResponse = await postGroqChat(apiKey, model, retryPrompt, false);
    const retryData = (await retryResponse.json()) as GroqResponse;
    const retryText = extractGroqText(retryData);
    if (retryResponse.ok && retryText) {
      return retryText;
    }
    throw new Error(retryData.error?.message || errorMessage);
  }

  throw new Error(errorMessage);
};

const requestAiText = async (prompt: string, generationConfig: Record<string, unknown>, jsonMode = false) => {
  const provider = (Constants.expoConfig?.extra?.aiProvider as string | undefined)?.toLowerCase() ?? 'auto';

  if (provider === 'groq') {
    return requestGroqText(prompt, jsonMode);
  }

  if (provider === 'gemini') {
    return requestGeminiText(prompt, generationConfig);
  }

  let geminiError: unknown;
  try {
    return await requestGeminiText(prompt, generationConfig);
  } catch (error) {
    geminiError = error;
  }

  try {
    return await requestGroqText(prompt, jsonMode);
  } catch (groqError) {
    const geminiMessage = geminiError instanceof Error ? geminiError.message : '';
    const groqMessage = groqError instanceof Error ? groqError.message : '';
    if (geminiMessage === 'GEMINI_API_KEY_MISSING' && groqMessage === 'GROQ_API_KEY_MISSING') {
      throw new Error('AI_API_KEY_MISSING');
    }
    throw new Error(groqMessage || geminiMessage || 'AI_FAILED');
  }
};

const requestVocabularyItems = async (prompt: string) =>
  parseJsonArray(
    await requestAiText(
      prompt,
      {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: buildSchema()
      },
      true
    )
  );

export const cleanOcrTextWithGemini = async (ocrText: string) => {
  const prompt = [
    'You are cleaning OCR output from an English book page for a Korean vocabulary-learning app.',
    'Return only the cleaned English text. Do not explain. Do not wrap in markdown.',
    'Rules:',
    '1. Preserve the original passage meaning and wording as much as possible.',
    '2. Fix OCR line-break errors and hyphenated split words. Example: "Pennsylva-\\nnia" -> "Pennsylvania".',
    '3. Restore clearly missing letters using context. Example: "mysteriou" -> "mysterious".',
    '4. Fix obvious spacing, capitalization, and punctuation problems.',
    '5. Remove meaningless OCR fragments only when they are clearly part of a broken word.',
    '6. Do not summarize, translate, add new sentences, or rewrite the passage creatively.',
    '7. Keep paragraph breaks when useful.',
    `OCR text:\n${ocrText}`
  ].join('\n');

  const cleaned = stripCodeBlock(
    await requestAiText(
      prompt,
      {
        temperature: 0
      },
      false
    )
  );

  return cleaned || ocrText;
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
  const levelRule = LEVEL_EXTRACTION_GUIDANCE[selectedLevel].join('\n');
  const prompt = [
    'You are extracting vocabulary candidates from OCR text for a Korean English-learning app.',
    'Return only useful vocabulary entries as JSON array. Do not wrap in markdown.',
    'Rules:',
    levelRule,
    '2. Correct OCR errors and broken fragments using context. Example: "Pennsylva- nia" or "pennsylva" + "nia" should become "Pennsylvania".',
    '3. Do not return meaningless OCR fragments such as "nia" when they are part of a broken word.',
    '4. Save dictionary headwords. Example: "climbed" -> "climb", "found" -> "find", "appeared" -> "appear".',
    '5. If a phrase, idiom, phrasal verb, or fixed expression is better to memorize together, return it as one phrase entry.',
    selectedLevel === 'Level 1'
      ? '6. Proper nouns may be included when they are important for understanding the passage; otherwise skip names that are not useful vocabulary.'
      : '6. Exclude common stop words and proper nouns unless useful for understanding the text.',
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

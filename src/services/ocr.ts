import Constants from 'expo-constants';

type OcrSpaceResponse = {
  ParsedResults?: Array<{ ParsedText?: string }>;
  OCRExitCode?: number;
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[];
  ErrorDetails?: string;
};

const toErrorText = (value?: string | string[]) => {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(', ');
  }
  return value;
};

export const readTextFromImage = async (uri: string) => {
  const apiKey = Constants.expoConfig?.extra?.ocrSpaceApiKey as string | undefined;
  if (!apiKey) {
    throw new Error('OCR_API_KEY_MISSING');
  }

  const formData = new FormData();
  formData.append('language', 'eng');
  formData.append('isOverlayRequired', 'false');
  formData.append('OCREngine', '2');
  formData.append('file', {
    uri,
    name: 'wordsnap.jpg',
    type: 'image/jpeg'
  } as unknown as Blob);

  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: {
      apikey: apiKey
    },
    body: formData
  });

  let data: OcrSpaceResponse;
  try {
    data = (await response.json()) as OcrSpaceResponse;
  } catch {
    throw new Error(`OCR 서버 응답을 읽지 못했어요. HTTP ${response.status}`);
  }

  const text = data.ParsedResults?.map((result) => result.ParsedText?.trim()).filter(Boolean).join('\n').trim();
  if (!response.ok || data.IsErroredOnProcessing || !text) {
    const errorMessage = toErrorText(data.ErrorMessage);
    const details = data.ErrorDetails;
    const status = response.ok ? undefined : `HTTP ${response.status}`;
    throw new Error(errorMessage || details || status || 'OCR 결과가 비어 있어요. 사진을 더 선명하게 찍거나 직접 입력해 주세요.');
  }
  return text;
};

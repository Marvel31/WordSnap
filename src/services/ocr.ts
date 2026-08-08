import Constants from 'expo-constants';

type OcrSpaceResponse = {
  ParsedResults?: Array<{ ParsedText?: string }>;
  ErrorMessage?: string | string[];
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

  const data = (await response.json()) as OcrSpaceResponse;
  const text = data.ParsedResults?.map((result) => result.ParsedText?.trim()).filter(Boolean).join('\n').trim();
  if (!response.ok || !text) {
    const errorMessage = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(', ') : data.ErrorMessage;
    throw new Error(errorMessage || 'OCR_FAILED');
  }
  return text;
};

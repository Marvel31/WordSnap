import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

const OCR_MAX_SIDE = 1800;
const OCR_COMPRESS = 0.65;
const OCR_SEGMENT_COUNT = 3;
const OCR_SEGMENT_OVERLAP_RATIO = 0.04;

export type OcrImage = {
  uri: string;
  width: number;
  height: number;
};

const saveOptions = {
  compress: OCR_COMPRESS,
  format: SaveFormat.JPEG
};

export const prepareImageForOcr = async (uri: string): Promise<OcrImage> => {
  const normalized = await manipulateAsync(uri, [], saveOptions);
  const maxSide = Math.max(normalized.width, normalized.height);
  const image =
    maxSide > OCR_MAX_SIDE
      ? await manipulateAsync(
          normalized.uri,
          [
            {
              resize: normalized.width >= normalized.height ? { width: OCR_MAX_SIDE } : { height: OCR_MAX_SIDE }
            }
          ],
          saveOptions
        )
      : normalized;

  return {
    uri: image.uri,
    width: image.width,
    height: image.height
  };
};

export const createOcrImageSegments = async (image: OcrImage) => {
  const splitByHeight = image.height >= image.width;
  const total = splitByHeight ? image.height : image.width;
  const cross = splitByHeight ? image.width : image.height;
  const segmentSize = Math.ceil(total / OCR_SEGMENT_COUNT);
  const overlap = Math.round(segmentSize * OCR_SEGMENT_OVERLAP_RATIO);

  return Promise.all(
    Array.from({ length: OCR_SEGMENT_COUNT }, async (_, index) => {
      const start = Math.max(0, index * segmentSize - (index === 0 ? 0 : overlap));
      const end = Math.min(total, (index + 1) * segmentSize + (index === OCR_SEGMENT_COUNT - 1 ? 0 : overlap));
      const length = end - start;
      const crop = splitByHeight
        ? { originX: 0, originY: start, width: cross, height: length }
        : { originX: start, originY: 0, width: length, height: cross };
      const segment = await manipulateAsync(image.uri, [{ crop }], saveOptions);
      return segment.uri;
    })
  );
};

export const joinOcrSegmentTexts = (texts: string[]) => texts.map((text) => text.trim()).filter(Boolean).join('\n\n');

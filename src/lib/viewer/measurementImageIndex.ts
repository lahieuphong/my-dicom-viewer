// Which image of a stack a measurement was made on; framework-free.

import { findMatchingImageIdIndex } from '@/lib/cornerstone/helpers';

type MeasurementLike = {
  metadata?: { referencedImageId?: unknown; imageId?: unknown; frameIndex?: unknown } | null;
  data?: { referencedImageId?: unknown; imageId?: unknown } | null;
};

/**
 * The index in `imageIds` of the image a measurement references. The live
 * annotation's reference comes first, then the measurement's; a recorded
 * frame index breaks ties between frames of one file and is the fallback
 * when no reference matches (clamped to the stack). 0 otherwise.
 */
export function resolveMeasurementImageIndex(
  measurement: MeasurementLike | null | undefined,
  imageIds: string[],
  annotation?: { metadata?: { referencedImageId?: unknown; imageId?: unknown } | null } | null
): number {
  const references = [
    annotation?.metadata?.referencedImageId,
    annotation?.metadata?.imageId,
    measurement?.metadata?.referencedImageId,
    measurement?.metadata?.imageId,
    measurement?.data?.referencedImageId,
    measurement?.data?.imageId,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  const storedIndex = Number(measurement?.metadata?.frameIndex);
  const validStoredIndex =
    Number.isInteger(storedIndex) && storedIndex >= 0 ? storedIndex : undefined;

  for (const reference of references) {
    const matchedIndex = findMatchingImageIdIndex(imageIds, reference, validStoredIndex);
    if (matchedIndex >= 0) return matchedIndex;
  }

  if (typeof validStoredIndex === 'number') {
    return Math.min(validStoredIndex, Math.max(0, imageIds.length - 1));
  }
  return 0;
}

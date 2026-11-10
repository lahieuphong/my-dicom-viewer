/**
 * Patient-space image positions known before an image is loaded.
 *
 * The static wadouri data source only yields Cornerstone `imagePlaneModule`
 * metadata once a DICOM file has been fetched and parsed. Data sources that
 * describe instance geometry up front (the generated manifest, or a PACS
 * returning DICOMweb-style metadata) register it here so synchronizers can
 * place slices of a stack that has not been loaded yet.
 */
export type ImagePosition = readonly [number, number, number];

const imagePositions = new Map<string, ImagePosition>();

function toImagePosition(value: unknown): ImagePosition | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const position = value.map(Number);
  return position.every(Number.isFinite)
    ? [position[0], position[1], position[2]]
    : null;
}

/** Registers the position of each image ID that has one; others are skipped. */
export function registerImagePositions(
  entries: Iterable<readonly [imageId: string, position: unknown]>
) {
  for (const [imageId, value] of entries) {
    const position = toImagePosition(value);
    if (imageId && position) imagePositions.set(imageId, position);
  }
}

export function getRegisteredImagePosition(imageId: string) {
  return imagePositions.get(imageId) ?? null;
}

import type { ViewportSeriesMap, ViewportSeriesOption } from './types';

function readInstanceCount(
  relatedInstanceCount: unknown,
  files: readonly unknown[] | undefined
): number {
  const rawCount = String(relatedInstanceCount ?? '').trim();
  const parsedCount = rawCount ? Number(rawCount) : Number.NaN;

  if (Number.isFinite(parsedCount) && parsedCount >= 0) {
    return Math.trunc(parsedCount);
  }

  return files?.length ?? 0;
}

export function buildViewportSeriesOptions(
  seriesMap: ViewportSeriesMap | undefined
): ViewportSeriesOption[] {
  return Object.entries(seriesMap ?? {}).flatMap(([uid, entry], index) => {
    const metadata = entry?.metadata;
    const modality = String(metadata?.seriesModality ?? '').trim().toUpperCase();

    // SR is rendered through the report flow, not as a background image layer.
    if (!metadata || modality === 'SR') return [];

    return [
      {
        uid,
        seriesNumber: String(metadata.seriesNumber ?? '').trim() || String(index + 1),
        description: String(metadata.seriesDescription ?? '').trim(),
        modality: modality || '—',
        instanceCount: readInstanceCount(metadata.seriesRelatedInstanceCount, entry.files),
      },
    ];
  });
}

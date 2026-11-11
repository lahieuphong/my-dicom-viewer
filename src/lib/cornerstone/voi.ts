// src/lib/cornerstone/voi.ts

/** The VOI range a series' metadata implies, from its Window Center/Width. */
export function getInitialVOIFromSeriesMetadata(metadata?: any): { lower: number; upper: number } | null {
  try {
    // Accept multiple common metadata shapes (windowCenter/windowWidth or wwc.center/wwc.width)
    const wc = metadata?.windowCenter ?? metadata?.wwc?.center ?? null;
    const ww = metadata?.windowWidth ?? metadata?.wwc?.width ?? null;
    if (typeof wc === 'number' && typeof ww === 'number' && ww > 0) {
      const lower = wc - ww / 2;
      const upper = wc + ww / 2;
      return { lower, upper };
    }
  } catch (e) {
    // swallow errors and return null
  }
  return null;
}

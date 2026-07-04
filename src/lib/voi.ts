// src/lib/voi.ts
import { cache } from '@cornerstonejs/core';

type VOIResult = { lower: number; upper: number; source?: string } | null;

/**
 * Parse a WindowCenter/WindowWidth like value (string/number/array) to number
 */
function parseWCWW(val: any): number | null {
  if (val == null) return null;
  if (Array.isArray(val) && val.length > 0) return Number(val[0]);
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

/**
 * Sample typed array (or plain array) up to maxSamples uniformly.
 */
function samplePixels(pixels: any, maxSamples = 100000): number[] {
  if (!pixels) return [];
  const len = pixels.length || 0;
  if (len <= maxSamples) return Array.from(pixels);
  const step = Math.floor(len / maxSamples) || 1;
  const out: number[] = [];
  for (let i = 0; i < len; i += step) out.push(pixels[i]);
  return out;
}

/**
 * Compute percentile p (0..100) from numeric array (copied & sorted).
 */
function percentile(arr: number[], p: number): number | null {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const a = arr.slice();
  a.sort((x, y) => x - y);
  const idx = (p / 100) * (a.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return a[lo];
  const w = idx - lo;
  return a[lo] * (1 - w) + a[hi] * w;
}

/**
 * Compute VOI for a given image or imageId using:
 * 1) DICOM WindowCenter/WindowWidth (if present)
 * 2) Percentile sampling (1%/99%) of pixel data
 * 3) fallback to min/max with a small padding
 *
 * Returns {lower, upper, source} or null on failure.
 */
export async function computeVOIFromImage(imageOrId: any): Promise<VOIResult> {
  try {
    const image =
      typeof imageOrId === 'string' ? cache?.getImage?.(imageOrId) : imageOrId;
    if (!image) return null;

    // 1) DICOM WC/WW
    const wcRaw = image.windowCenter ?? image.WindowCenter ?? image.metadata?.windowCenter ?? null;
    const wwRaw = image.windowWidth ?? image.WindowWidth ?? image.metadata?.windowWidth ?? null;
    const wc = parseWCWW(wcRaw);
    const ww = parseWCWW(wwRaw);
    if (wc !== null && ww !== null && Number.isFinite(wc) && Number.isFinite(ww) && ww > 0) {
      const lower = wc - ww / 2;
      const upper = wc + ww / 2;
      return { lower, upper, source: 'dicomWCWW' };
    }

    // 2) Try getPixelData (most loaders support image.getPixelData())
    const getPixels = typeof image.getPixelData === 'function' ? image.getPixelData.bind(image) : null;
    if (getPixels) {
      try {
        const raw = getPixels();
        const sample = samplePixels(raw, 100000);
        const low = percentile(sample, 1);
        const high = percentile(sample, 99);
        if (low !== null && high !== null && high > low) {
          return { lower: low, upper: high, source: 'percentile_1_99' };
        }
      } catch (e) {
        // ignore and fallback
      }
    }

    // 3) fallback to min/max if present on image
    const min = typeof image.minPixelValue === 'number' ? image.minPixelValue : null;
    const max = typeof image.maxPixelValue === 'number' ? image.maxPixelValue : null;
    if (min !== null && max !== null && max > min) {
      const range = max - min;
      const lower = min + range * 0.02;
      const upper = max - range * 0.02;
      return { lower, upper, source: 'minmax' };
    }
  } catch (e) {
    // swallow
  }
  return null;
}

/**
 * Apply VOI (voiRange) to a StackViewport instance.
 * Accepts viewportInstance and either an imageId or image object to compute VOI.
 *
 * Optionally returns the computed VOI so caller can cache it.
 */
export async function applyVOI(
  viewportInstance: any,
  imageIdOrObj: any,
  opts?: { persistTo?: (v: { lower: number; upper: number }) => void }
): Promise<VOIResult> {
  if (!viewportInstance || !imageIdOrObj) return null;
  try {
    const computed = await computeVOIFromImage(imageIdOrObj);
    if (!computed) return null;
    const lower = Number(computed.lower);
    const upper = Number(computed.upper);
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return null;
    try {
      viewportInstance.setProperties?.({ voiRange: { lower, upper } });
    } catch (e) {
      // ignore
    }
    if (opts?.persistTo) {
      try { opts.persistTo({ lower, upper }); } catch {}
    }
    return { lower, upper, source: computed.source };
  } catch (e) {
    return null;
  }
}

/**
 * Simple in-memory cache for computed VOI values keyed by imageId or seriesUID.
 * Use cacheVOI.get(key) / set(key, value) from caller if desired.
 */
export const cacheVOI = new Map<string, { lower: number; upper: number }>();


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

export default {
  computeVOIFromImage,
  applyVOI,
  cacheVOI,
  getInitialVOIFromSeriesMetadata,
};


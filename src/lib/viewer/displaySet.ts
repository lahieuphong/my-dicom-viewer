// src/lib/viewer/displaySet.ts
'use client';

import type { Series } from '@/lib/pacs/services';
import { getInitialVOIFromSeriesMetadata } from '@/lib/cornerstone/voi';
import { normalizeImageId } from '@/lib/cornerstone/helpers';

export interface DisplaySet {
  imageIds: string[];
  initialImageIdIndex: number;
  initialVOIRange?: { lower: number; upper: number } | null;
  seriesInstanceUID?: string | null;
}

/**
 * Convert a raw file identifier into a Cornerstone-compatible imageId.
 * Rules:
 *  - If value already contains a scheme (e.g. starts with "wadouri:", "dicomweb:", "imageId:") -> return as-is
 *  - If value is an absolute http(s) URL -> prefix with "wadouri:"
 *  - If value starts with "/" -> treat as absolute path on same origin -> prefix with window.location.origin + "wadouri:"
 *  - Otherwise treat as relative path -> prefix with window.location.origin + "/" and "wadouri:"
 *
 * This normalization ensures the dicom-image-loader (wadouri) recognizes and can load imageIds.
 */
function toCornerstoneImageId(raw?: string | null): string {
  if (!raw) return String(raw ?? '');
  const s = String(raw).trim();
  // already has a scheme like 'wadouri:', 'dicomweb:', 'imageId:', 'http:', etc.
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) {
    return s;
  }

  // absolute http(s)
  if (/^https?:\/\//i.test(s)) {
    return `wadouri:${s}`;
  }

  // path starting with '/'
  if (s.startsWith('/')) {
    return `wadouri:${window.location.origin}${s}`;
  }

  // fallback: relative path
  return `wadouri:${window.location.origin}/${s}`;
}

/**
 * Create display set and attempt to sort images by InstanceNumber if metadata available.
 * Expect `series` is an object { files: string[], metadata?: Series } where metadata
 * may contain a map of per-file metadata (common patterns: metadata.instances, metadata.filesMeta).
 */
export function createDisplaySetFromSeries(series?: { files?: string[]; metadata?: Series } | null): DisplaySet | null {
  if (!series) return null;
  const files = Array.isArray(series.files) ? series.files.slice() : [];
  const metadata = series.metadata ?? ({} as Series);

  const perFileMeta: Record<string, any> =
    (metadata as any)?.instances ?? (metadata as any)?.filesMeta ?? (metadata as any)?.fileMetadataMap ?? {};

  const arr = files.map((id, idx) => {
    // use shared normalizer
    const norm = normalizeImageId(id);
    let instNum: number | null = null;
    try {
      const metaCandidate = perFileMeta?.[norm] ?? perFileMeta?.[id] ?? null;
      if (metaCandidate) {
        const n = metaCandidate.instanceNumber ?? metaCandidate.InstanceNumber ?? metaCandidate.instance_number ?? metaCandidate.instance ?? null;
        const parsed = typeof n === 'string' || typeof n === 'number' ? Number(n) : NaN;
        if (Number.isFinite(parsed)) instNum = parsed;
      }
    } catch {}
    // fallback parse query string as before...
    try {
      const qIx = String(id).indexOf('?');
      if (qIx >= 0) {
        const qs = new URLSearchParams(String(id).slice(qIx + 1));
        const qv = qs.get('instanceNumber') ?? qs.get('instance') ?? qs.get('i');
        if (qv) {
          const parsed = Number(qv);
          if (Number.isFinite(parsed)) instNum = parsed;
        }
      }
    } catch {}
    return { id, idx, norm, instanceNumber: instNum };
  });

  const hasInstanceInfo = arr.some((x) => typeof x.instanceNumber === 'number');
  const sorted = hasInstanceInfo ? arr.slice().sort((a,b) => {
    const ai = typeof a.instanceNumber === 'number' ? a.instanceNumber : Number.POSITIVE_INFINITY;
    const bi = typeof b.instanceNumber === 'number' ? b.instanceNumber : Number.POSITIVE_INFINITY;
    if (ai === bi) return a.idx - b.idx;
    return ai - bi;
  }) : arr;

  // IMPORTANT: normalize imageIds once here using shared util
  const imageIds = sorted.map((x) => toCornerstoneImageId(x.id));
  const initialIndex = 0;
  const seriesInstanceUID = (metadata as any)?.seriesInstanceUID ?? null;

  // use new helper from voi.ts
  const initialVOI = getInitialVOIFromSeriesMetadata(metadata);

  return {
    imageIds,
    initialImageIdIndex: initialIndex,
    initialVOIRange: initialVOI,
    seriesInstanceUID,
  };
}

// src/lib/viewer/ensureStackLogger.ts
'use client';

import { getEnabledElementSafeLocal } from './dom';

export interface EnsureStackLogParams {
  reason: string;
  requestToken?: string | null;
  viewportId?: string | null;
  preserveCurrentIndex?: boolean;
  imageIds?: string[] | null;
  viewportEl?: HTMLElement | null;
}

/**
 * Dev-only logging helper for ensureStackOnViewport failures.
 * Prints a compact snapshot (enabled element, dataset, caller trace) only in development.
 */
export function logEnsureStackFailure(params: EnsureStackLogParams): void {
  if (process.env.NODE_ENV !== 'development') return;

  try {
    const {
      reason,
      requestToken = null,
      viewportId = null,
      preserveCurrentIndex = false,
      imageIds = null,
      viewportEl = null,
    } = params;

    // safe get enabled element
    let enabled: any = null;
    try {
      enabled = getEnabledElementSafeLocal(viewportEl as any);
    } catch (e) {
      // noop
    }

    // Robust computation of "enabledHasImage":
    // - prefer enabled.image presence
    // - try enabled.viewport.getCurrentImageIdIndex()
    // - try enabled.viewport.getImageIds()
    // - try enabled.getCurrentImageIdIndex()
    let enabledHasImage = false;
    try {
      if (enabled) {
        // direct image check
        if ((enabled as any).image) {
          enabledHasImage = true;
        } else {
          // check viewport helpers
          const vp = (enabled as any).viewport ?? null;
          if (vp) {
            try {
              if (typeof vp.getCurrentImageIdIndex === 'function') {
                const idx = vp.getCurrentImageIdIndex();
                if (typeof idx === 'number' && idx >= 0) enabledHasImage = true;
              }
            } catch {}
            if (!enabledHasImage) {
              try {
                if (typeof vp.getImageIds === 'function') {
                  const ids = vp.getImageIds();
                  if (Array.isArray(ids) && ids.length > 0) enabledHasImage = true;
                }
              } catch {}
            }
          }

          // legacy enabled.getCurrentImageIdIndex
          if (!enabledHasImage) {
            try {
              if (typeof (enabled as any).getCurrentImageIdIndex === 'function') {
                const idx2 = (enabled as any).getCurrentImageIdIndex();
                if (typeof idx2 === 'number' && idx2 >= 0) enabledHasImage = true;
              }
            } catch {}
          }
        }
      }
    } catch (e) {
      // swallow – best-effort only
      enabledHasImage = Boolean((enabled as any)?.image);
    }

    // Try to safely obtain viewport imageIds (best-effort)
    let enabledViewportImageIds: string[] | null = null;
    try {
      const vp = (enabled as any)?.viewport ?? null;
      if (vp && typeof vp.getImageIds === 'function') {
        try {
          const ids = vp.getImageIds();
          if (Array.isArray(ids)) enabledViewportImageIds = ids.slice(0, 30); // cap length for safety
        } catch {}
      } else if (typeof (enabled as any).getImageIds === 'function') {
        try {
          const ids2 = (enabled as any).getImageIds();
          if (Array.isArray(ids2)) enabledViewportImageIds = ids2.slice(0, 30);
        } catch {}
      }
    } catch {}

    const payload = {
      reason,
      requestToken,
      viewportId,
      preserveCurrentIndex,
      imageCount: Array.isArray(imageIds) ? imageIds.length : null,
      pendingOnEl: viewportEl?.dataset?.__pendingStackRequestId ?? null,
      now: new Date().toISOString(),
      enabledExists: !!enabled,
      enabledHasImage,
      enabledViewportImageIds,
      elDataset: viewportEl?.dataset ? { ...(viewportEl as any).dataset } : null,
      // attach a short caller stack to help find the caller location
      caller: (new Error()).stack?.split('\n').slice(2, 6).join('\n') ?? null,
    };

    // Use console.warn so it's visible in console (dev only)
    // Wrap in try/catch so this helper never throws
    try {
      console.warn('[stack.ensure] returning false reason=', payload);
    } catch (e) {}
  } catch (e) {
    // swallow any error from logging helper
  }
}

export default {
  logEnsureStackFailure,
};

// src/lib/viewer/attachDisplaySet.ts
'use client';

import { normalizeCanvasAndContext } from '@/lib/viewer/canvasUtils';
import { ensureStackOnViewport } from './stack';
import { getPreloadWindow, preloadImagesWithTimeout } from './preload';
import type { DisplaySet } from './displaySet';
import type { EngineRef } from './stack';
import { VIEWPORT_ID } from '@/constants/viewport';

function getEnabledElementSafeLocal(el: HTMLElement | null | undefined): any | null {
  try {
    if (!el || typeof window === 'undefined') return null;
    const cornerstone = (window as any).__cornerstoneCore ?? null;
    if (!cornerstone || typeof cornerstone.getEnabledElement !== 'function') return null;
    return cornerstone.getEnabledElement(el);
  } catch {
    return null;
  }
}

function imageListsEqual(a: any[] | null | undefined, b: any[] | null | undefined): boolean {
  try {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function clampIndex(index: number, imageCount: number): number {
  return Math.max(0, Math.min(Number.isFinite(index) ? Math.floor(index) : 0, Math.max(0, imageCount - 1)));
}

function readViewportImageIndex(viewportInstance?: any, viewportEl?: HTMLElement | null): number | null {
  try {
    if (viewportInstance) {
      if (typeof viewportInstance.getCurrentImageIdIndex === 'function') {
        const idx = Number(viewportInstance.getCurrentImageIdIndex());
        if (Number.isFinite(idx) && idx >= 0) return idx;
      }
      if (typeof viewportInstance.getImageIdIndex === 'function') {
        const idx = Number(viewportInstance.getImageIdIndex());
        if (Number.isFinite(idx) && idx >= 0) return idx;
      }
    }
  } catch {}

  try {
    const en = getEnabledElementSafeLocal(viewportEl);
    const vp = en?.viewport ?? en;
    if (vp && typeof vp.getCurrentImageIdIndex === 'function') {
      const idx = Number(vp.getCurrentImageIdIndex());
      if (Number.isFinite(idx) && idx >= 0) return idx;
    }
    if (vp && typeof vp.getImageIdIndex === 'function') {
      const idx = Number(vp.getImageIdIndex());
      if (Number.isFinite(idx) && idx >= 0) return idx;
    }
  } catch {}

  return null;
}

async function forceViewportToIndex(opts: {
  renderingEngineRef?: EngineRef;
  viewportInstance?: any;
  viewportEl?: HTMLDivElement | null;
  imageIds: string[];
  index: number;
  viewportId: string;
  requestToken: string;
}): Promise<number> {
  const { renderingEngineRef, viewportInstance, viewportEl, imageIds, index, viewportId, requestToken } = opts;
  const targetIndex = clampIndex(index, imageIds.length);
  const targetImageId = imageIds[targetIndex];
  const engine: any = renderingEngineRef?.current ?? null;

  let vp: any = viewportInstance ?? null;
  if (!vp && viewportEl) {
    try {
      vp = getEnabledElementSafeLocal(viewportEl)?.viewport ?? null;
    } catch {}
  }

  try {
    if (vp) {
      let currentIds: string[] | null = null;
      try {
        currentIds = typeof vp.getImageIds === 'function' ? vp.getImageIds?.() ?? null : null;
      } catch {}

      if (typeof vp.setStack === 'function' && !imageListsEqual(currentIds, imageIds)) {
        await Promise.resolve(vp.setStack(imageIds, targetIndex)).catch((err: any) => {
        });
      }

      const currentIndex = readViewportImageIndex(vp, viewportEl);
      if (currentIndex !== targetIndex) {
        if (typeof vp.setImageIndex === 'function') {
          await Promise.resolve(vp.setImageIndex(targetIndex)).catch((err: any) => {
          });
        } else if (typeof vp.setImageId === 'function' && targetImageId) {
          await Promise.resolve(vp.setImageId(targetImageId)).catch((err: any) => {
          });
        } else if (typeof vp.setStack === 'function') {
          await Promise.resolve(vp.setStack(imageIds, targetIndex)).catch((err: any) => {
          });
        }
      }
    } else if (engine && typeof engine.setStacks === 'function') {
      engine.setStacks([{ viewportId, imageIds, index: targetIndex, __requestToken: requestToken }]);
    }
  } catch (err) {
  }

  try { engine?.resize?.(); } catch {}
  try { engine?.renderViewport?.(viewportId); } catch {}
  try { await vp?.render?.(); } catch {}
  try { normalizeCanvasAndContext(viewportEl); } catch {}

  return targetIndex;
}

export async function attachDisplaySetToViewport(opts: {
  displaySet: DisplaySet;
  renderingEngineRef?: EngineRef;
  viewportInstance?: any;
  viewportEl?: HTMLDivElement | null;
  ensureImageRendered?: any;
  preloadImagesWithTimeoutFn?: typeof preloadImagesWithTimeout;
  desiredIndex?: number;
  viewportId?: string;
  // new: whether to lock viewport to the index used for this attach (default true)
  lockAfterAttach?: boolean;
}) {
  const {
    displaySet,
    renderingEngineRef,
    viewportInstance,
    viewportEl,
    ensureImageRendered,
    preloadImagesWithTimeoutFn = preloadImagesWithTimeout,
    viewportId = VIEWPORT_ID,
    lockAfterAttach = true,
    desiredIndex: optDesiredIndex,
  } = opts;

  const imageIds = displaySet.imageIds ?? [];
  if (!imageIds || imageIds.length === 0) return false;

  // If caller supplies desiredIndex we respect it; otherwise default to initialImageIdIndex OR 0.
  const defaultDesiredIndex =
    typeof optDesiredIndex === 'number' ? optDesiredIndex : Math.max(0, (displaySet.initialImageIdIndex ?? 0));
  const desiredIndex = Math.max(0, Math.min(defaultDesiredIndex, imageIds.length - 1));

  // generate a request token to mark ownership of changes
  const requestToken = (() => {
    try {
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    } catch {
      return String(Math.random());
    }
  })();


  // annotate element with pending token
  try {
    if (viewportEl && viewportEl instanceof HTMLElement) {
      (viewportEl as any).dataset.__pendingStackRequestId = requestToken;
      try {
        delete (viewportEl.dataset as any).__stackLockedOwner;
        delete (viewportEl.dataset as any).__stackLocked;
      } catch {}
    }
  } catch {}

  // early normalize canvas
  try {
    normalizeCanvasAndContext(viewportEl);
  } catch {}

  // Try quick engine-level setStacks (non-blocking) but include token so wrappers can respect owner.
  // NEW: only call setStacks if viewport is empty or a different stack is present (idempotent guard).
  try {
    const eng: any = renderingEngineRef?.current ?? null;
    if (eng && typeof eng.setStacks === 'function') {
      let already = false;
      try {
        // Prefer using the enabled element to inspect current stack on the DOM element
        const en = getEnabledElementSafeLocal(viewportEl as any);
        const curIds = en?.viewport?.getImageIds?.() ?? null;
        if (Array.isArray(curIds) && imageListsEqual(curIds, imageIds)) {
          already = true;
        }
      } catch {}
      if (!already) {
        try {
          eng.setStacks?.([{ viewportId, imageIds, index: desiredIndex, __requestToken: requestToken }]);
          try { eng.renderViewport?.(viewportId); } catch {}
        } catch (err) {
        }
      } else {
      }
    }
  } catch (err) {
  }

  /* --------------------------------------------------------------------------
     NEW: Use AbortController per-viewport for preloads, wrap preload to expose
     onProgress that reports percent relative to full series (imageIds.length).
     Pass the wrapped preload into ensureStackOnViewport so it reuses same signal/handler.
     -------------------------------------------------------------------------- */
  try {
    try {
      const key = `__viewerPreloadController_${viewportId}`;
      // abort previous controller if exists
      try {
        const prev: AbortController | undefined = (typeof window !== 'undefined' ? (window as any)[key] : undefined);
        if (prev && typeof prev.abort === 'function') {
          try {
            prev.abort();
          } catch {}
        }
      } catch {}

      // create new controller and store it keyed by viewportId
      const ac = typeof AbortController !== 'undefined' ? new AbortController() : (null as any);
      try {
        if (typeof window !== 'undefined') (window as any)[key] = ac;
      } catch {}

      // progress wrapper: compute percentage relative to full series (imageIds.length)
      const progressWrapper = (loaded: number, batchTotal: number) => {
        try {
          const seriesTotal = imageIds.length || Math.max(1, batchTotal);
          const percent = Math.round((loaded / Math.max(1, seriesTotal)) * 100);
          try { (window as any).__viewerLoadingProgress?.(percent); } catch {}
        } catch {}
      };

      // wrapper to pass into ensureStackOnViewport (bind the controller + progress wrapper)
      const preloadWrapper = async (ids: string[], opts: any = {}) => {
        try {
          const mergedOpts = {
            ...(opts || {}),
            signal: ac?.signal,
            onProgress: (loaded: number, batchTotal: number) => {
              try {
                progressWrapper(loaded, batchTotal);
                if (typeof opts?.onProgress === 'function') {
                  try { opts.onProgress(loaded, batchTotal); } catch {}
                }
              } catch {}
            },
          };
          // call the real preload function (use provided function if present)
          const fn = preloadImagesWithTimeoutFn ?? preloadImagesWithTimeout;
          return fn(ids, mergedOpts);
        } catch (e) {
          // ensure errors propagate so callers can handle them
          throw e;
        }
      };

      // WARM PRELOAD: call preloadWrapper (best-effort). Use a small limit to warm.
      try {
        const warmIds = getPreloadWindow(imageIds, desiredIndex, {
          backward: 3,
          forward: 12,
          max: 16,
        });

        await preloadWrapper(warmIds, {
          concurrency: 3,
          perLoadTimeoutMs: 7000,
          limit: warmIds.length,
        }).catch(() => {});
      } catch (e) {
        // swallow warm preload errors but log
      }

      // Call ensureStackOnViewport but *pass our bound preloadWrapper* so ensureStack won't create independent preloads.
      const ok = await ensureStackOnViewport({
        renderingEngineRef,
        viewportInstance,
        viewportEl,
        imageIds,
        desiredIndex,
        ensureImageRendered,
        // IMPORTANT: pass our bound wrapper so progress and signal are consistent
        preloadImagesWithTimeout: preloadWrapper,
        viewportId,
        settleMs: 120,
      }).catch((e) => {
        return false;
      });

      // cleanup controller regardless (attach finished/failed)
      try {
        const cur: AbortController | undefined = (typeof window !== 'undefined' ? (window as any)[key] : undefined);
        if (cur === ac) {
          try { delete (window as any)[key]; } catch {}
        }
      } catch {}


      if (!ok) {
        // cleanup pending token because attach failed / aborted
        try {
          if (viewportEl && (viewportEl as any).dataset && (viewportEl as any).dataset.__pendingStackRequestId === requestToken) {
            try {
              delete (viewportEl as any).dataset.__pendingStackRequestId;
            } catch {}
          }
        } catch {}
        return false;
      }

    } catch (e) {
      // swallow any preload/controller errors but log
    }
  } catch (e) {
    /* swallow top-level */
  }

  // 2) final housekeeping: reset presentation before applying the requested frame.
  try {
    try { viewportInstance?.reset?.(); } catch {}
    try { renderingEngineRef?.current?.resize?.(); } catch {}
    try { renderingEngineRef?.current?.renderViewport?.(viewportId); } catch {}
    try { await viewportInstance?.render?.(); } catch {}
  } catch (e) {
  }

  // 3) The requested index is authoritative. Preload/render nudges must not
  // advance the stack and then become the locked display frame.
  const effectiveIndex = await forceViewportToIndex({
    renderingEngineRef,
    viewportInstance,
    viewportEl,
    imageIds,
    index: desiredIndex,
    viewportId,
    requestToken,
  });

  try {
    const runtimeIndex = readViewportImageIndex(viewportInstance, viewportEl);
    if (runtimeIndex !== null && runtimeIndex !== effectiveIndex) {
    }
  } catch (err) {
  }

  // 4) Lock viewport to the index we actually attached (so later callers don't stomp)
  try {
    if (viewportEl && (viewportEl as any).dataset) {
      (viewportEl as any).dataset.__stackLockedOwner = requestToken;
      (viewportEl as any).dataset.__stackLocked = '1';
      (viewportEl as any).dataset.__stackLockedIndex = String(effectiveIndex);
      try { delete (viewportEl as any).dataset.__pendingStackRequestId; } catch {}
    }

    // Additionally call engine.setStacks with token+index to register ownership for wrappers
    try {
      const eng: any = renderingEngineRef?.current ?? null;
      if (eng && typeof eng.setStacks === 'function') {
        let already = false;
        try {
          const curIdsFromVpInstance =
            (typeof viewportInstance?.getImageIds === 'function' ? viewportInstance.getImageIds?.() : null) ?? null;
          if (Array.isArray(curIdsFromVpInstance) && imageListsEqual(curIdsFromVpInstance, imageIds)) {
            already = true;
          } else if (!already) {
            const en = getEnabledElementSafeLocal(viewportEl as any);
            const curIds = en?.viewport?.getImageIds?.() ?? null;
            if (Array.isArray(curIds) && imageListsEqual(curIds, imageIds)) {
              already = true;
            }
          }
        } catch {}
        if (!already) {
          try {
            eng.setStacks?.([{ viewportId, imageIds, index: effectiveIndex, __requestToken: requestToken }]);
          } catch (err) {
          }
        } else {
        }
      }
    } catch (err) {
    }
  } catch (e) {
    // swallow
  }

  // 5) Dispatch STACK_NEW_IMAGE with effectiveIndex (so tools/annotations sync)
  try {
    const eventName =
      (typeof window !== 'undefined' &&
        (window as any).__cornerstoneCore &&
        (window as any).__cornerstoneCore?.Events?.STACK_NEW_IMAGE) ??
      'cornerstone-stack-new-image';
    const targetEl = viewportEl ?? (viewportInstance as any)?.element ?? document.querySelector(`[data-viewport-uid="${viewportId}"]`);
    try {
      targetEl?.dispatchEvent?.(new CustomEvent(eventName, { detail: { imageIdIndex: Number(effectiveIndex) }, bubbles: true }));
    } catch (err) {
    }
  } catch (err) {
  }

  // 6) ensure VOI if displaySet has it
  try {
    const voi = displaySet.initialVOIRange ?? null;
    if (voi && viewportInstance && typeof viewportInstance.setProperties === 'function') {
      try {
        viewportInstance.setProperties?.({ voiRange: voi });
      } catch {}
      try { renderingEngineRef?.current?.renderViewport?.(viewportId); } catch {}
      try { await viewportInstance?.render?.(); } catch {}
    }
  } catch {}

  // final normalize & render
  try { normalizeCanvasAndContext(viewportEl); } catch {}
  try { renderingEngineRef?.current?.resize?.(); } catch {}
  try { renderingEngineRef?.current?.renderViewport?.(viewportId); } catch {}
  try { await viewportInstance?.render?.(); } catch {}


  return true;
}

export default attachDisplaySetToViewport;

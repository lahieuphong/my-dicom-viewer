// src/lib/viewer/stack.ts
'use client';

import { getEnabledElementSafeLocal, normalizeId } from './dom';
import { VIEWPORT_ID } from '@/constants/viewport';
import { forceRenderCheck } from './polling';
import {
  ATTEMPTS_SETSTACK,
  ATTEMPTS_POLL,
  DEFAULT_SETTLE_MS,
  USER_COOLDOWN_MS,
} from './constants'; // hoặc '@/lib/viewer/constants'
import { wait } from '@/lib/utils/wait';
import { logEnsureStackFailure } from './ensureStackLogger';

// <- reuse centralized preload helper when caller doesn't provide one
import { preloadImagesWithTimeout as sharedPreloadImagesWithTimeout } from '@/lib/viewer/preload';

/* ----------------------------- Types / Helpers ----------------------------- */

export type EngineRef = { current: any } | undefined;

export interface EnsureStackParams {
  renderingEngineRef?: EngineRef;
  viewportInstance?: any;
  viewportEl?: HTMLDivElement | null;
  imageIds: string[];
  desiredIndex?: number;
  preserveCurrentIndex?: boolean;
  ensureImageRendered?: (
    viewportInstance: any,
    viewportEl: HTMLDivElement | null,
    imageIds: string[],
    desiredIndex: number,
    pollIntervalMs?: number,
    timeoutMs?: number
  ) => Promise<boolean>;
  preloadImagesWithTimeout?: (imageIds: string[], opts?: any) => Promise<void>;
  viewportId?: string;
  settleMs?: number;
}

/** IN-FLIGHT LOCK (prevent concurrent ensure for same viewportInstance) */
const _ensuringMap = new WeakMap<any, boolean>(); // viewportInstance -> boolean

const isDev = process.env.NODE_ENV === 'development';

function pushViewerLog(evt: string, payload: Record<string, any> = {}) {
  try {
    const w: any = (typeof window !== 'undefined') ? (window as any) : null;
    if (!w) return;
    w.__viewerLog = w.__viewerLog || [];
    w.__viewerLog.push({ t: Date.now(), evt, ...payload });
    if (w.__viewerLog.length > 4000) w.__viewerLog.splice(0, w.__viewerLog.length - 4000);
  } catch {}
}

function makeToken(): string {
  try {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  } catch {
    return String(Math.random());
  }
}

function safeNormalizeId(s: any): string {
  try {
    const n = normalizeId(String(s ?? '')) ?? '';
    return String(n).replace(/^imageid:/i, '').split('?')[0];
  } catch {
    return String(s ?? '');
  }
}

async function safeImportCornerstoneCore(): Promise<any | null> {
  try {
    const csCore = await import('@cornerstonejs/core').catch(() => null);
    return csCore ?? null;
  } catch {
    return null;
  }
}

/* ------------------------------ loadImageSafe ------------------------------ */

export async function loadImageSafe(imageId?: string | null): Promise<boolean> {
  if (!imageId) return false;

  try {
    const win = typeof window !== 'undefined' ? (window as any) : null;

    // 1) Global custom loader function
    try {
      const globalFn = win?.__cornerstoneImageLoaderFn ?? null;
      if (typeof globalFn === 'function') {
        await globalFn(imageId).catch(() => {});
        pushViewerLog('stack.loadImageSafe.usedGlobalFn', { imageId });
        return true;
      }
    } catch (err) {
      pushViewerLog('stack.loadImageSafe.globalFnError', { imageId, err: String(err) });
    }

    // 2) Global cornerstone core-ish loader
    try {
      const csGlobal = win?.__cornerstoneCore ?? null;
      const loaderFromGlobal = csGlobal?.imageLoader ?? null;
      if (loaderFromGlobal && typeof loaderFromGlobal.loadAndCacheImage === 'function') {
        await loaderFromGlobal.loadAndCacheImage(imageId).catch(() => {});
        pushViewerLog('stack.loadImageSafe.usedCsCore', { imageId });
        return true;
      }
    } catch (err) {
      pushViewerLog('stack.loadImageSafe.csCoreError', { imageId, err: String(err) });
    }

    // 3) Dynamic import of @cornerstonejs/core
    try {
      const csCore = await safeImportCornerstoneCore();
      const dyn = csCore ? (csCore as any).imageLoader : null;
      if (dyn && typeof dyn.loadAndCacheImage === 'function') {
        await dyn.loadAndCacheImage(imageId).catch(() => {});
        pushViewerLog('stack.loadImageSafe.usedDynamic', { imageId });
        return true;
      }
    } catch (err) {
      pushViewerLog('stack.loadImageSafe.dynamicError', { imageId, err: String(err) });
    }

    return false;
  } catch (err) {
    if (isDev) {
      // eslint-disable-next-line no-console
      console.debug('[stack] loadImageSafe failed for', imageId, err);
    }
    pushViewerLog('stack.loadImageSafe.failed', { imageId, err: String(err) });
    return false;
  }
}

/* --------------------------- ensureStackOnViewport -------------------------- */

export async function ensureStackOnViewport(params: EnsureStackParams): Promise<boolean> {
  const {
    renderingEngineRef,
    viewportInstance,
    viewportEl,
    imageIds,
    ensureImageRendered,
    preloadImagesWithTimeout,
    viewportId = VIEWPORT_ID,
    settleMs = DEFAULT_SETTLE_MS,
  } = params;

  const preloadFn = typeof preloadImagesWithTimeout === 'function' ? preloadImagesWithTimeout : sharedPreloadImagesWithTimeout;

  // desiredIndex default 0
  let desiredIndex = typeof params.desiredIndex === 'number' ? params.desiredIndex : 0;
  const preserveCurrentIndex = Boolean(params.preserveCurrentIndex);

  const requestToken = makeToken();

  pushViewerLog('stack.start', { requestToken, imageCount: imageIds.length, desiredIndex });

  const devLogFalse = (reason: string) => {
    try {
      logEnsureStackFailure({
        reason,
        requestToken,
        viewportId,
        preserveCurrentIndex,
        imageIds,
        viewportEl,
      });
    } catch {
      // never throw from logger
    }
    pushViewerLog('stack.fail', { requestToken, reason });
  };

  if (!Array.isArray(imageIds) || imageIds.length === 0) {
    devLogFalse('empty-or-invalid-imageids');
    return false;
  }

  /* -------------------- EARLY IDEMPOTENT CHECK (fast path) -------------------- */
  try {
    const elToInspect =
      viewportEl ??
      (viewportInstance as any)?.element ??
      (typeof document !== 'undefined' ? document.querySelector(`[data-viewport-uid="${viewportId}"]`) : null);

    let currentIds: string[] | null = null;
    let currentIdx: number | null = null;

    // try viewportInstance API first
    try {
      if (viewportInstance && typeof viewportInstance.getImageIds === 'function') {
        currentIds = viewportInstance.getImageIds?.() ?? null;
        if (typeof viewportInstance.getCurrentImageIdIndex === 'function') {
          currentIdx = viewportInstance.getCurrentImageIdIndex?.() ?? null;
        }
      }
    } catch {}

    // fallback to enabled element
    if ((!currentIds || currentIds.length === 0) && elToInspect) {
      try {
        const en = getEnabledElementSafeLocal(elToInspect as HTMLDivElement | null);
        if (en) {
          if (en.viewport && typeof en.viewport.getImageIds === 'function') {
            currentIds = en.viewport.getImageIds?.() ?? currentIds;
          }
          if (currentIdx == null) {
            if (en.viewport && typeof en.viewport.getCurrentImageIdIndex === 'function') {
              currentIdx = en.viewport.getCurrentImageIdIndex?.() ?? currentIdx;
            } else if (typeof (en as any).getCurrentImageIdIndex === 'function') {
              currentIdx = (en as any).getCurrentImageIdIndex?.() ?? currentIdx;
            }
          }
        }
      } catch {}
    }

    if (Array.isArray(currentIds) && currentIds.length > 0) {
      const sameLength = currentIds.length === imageIds.length;
      let listsEqual = false;
      if (sameLength) {
        listsEqual = currentIds.every((v, i) => safeNormalizeId(v) === safeNormalizeId(imageIds[i]));
      }

      const idxMatches =
        typeof currentIdx === 'number' &&
        currentIdx >= 0 &&
        typeof desiredIndex === 'number' &&
        currentIdx === desiredIndex;

      if (listsEqual && idxMatches) {
        pushViewerLog('stack.earlyExit.sameStackAndIndex', { requestToken });
        if (isDev) {
          console.debug('[ensureStackOnViewport] early-exit: viewport already has same stack+index');
        }
        return true;
      }
    }
  } catch {
    // swallow early check errors
  }

  /* --------------------- Final-lock / concurrent guard --------------------- */
  try {
    const locked = (viewportEl as any)?.dataset?.__stackLocked ?? null;
    const lockedOwner = (viewportEl as any)?.dataset?.__stackLockedOwner ?? null;
    if (locked === '1' && lockedOwner) {
      pushViewerLog('stack.locked', { requestToken, lockedOwner });
      if (isDev) {
        console.debug('[stack.ensure] viewport is final-locked by owner, aborting', { lockedOwner });
      }
      devLogFalse('final-lock');
      return false;
    }
  } catch {}

  if (viewportInstance && _ensuringMap.get(viewportInstance)) {
    pushViewerLog('stack.concurrentLock', { requestToken });
    if (isDev) {
      console.debug('[stack.ensure] concurrent ensure detected -> skipping');
    }
    devLogFalse('concurrent-lock');
    return false;
  }

  if (viewportInstance) _ensuringMap.set(viewportInstance, true);

  try {
    try {
      if (viewportEl && viewportEl instanceof HTMLElement) {
        (viewportEl as any).dataset.__pendingStackRequestId = requestToken;
        (viewportEl as any).dataset.__pendingStackDesiredIndex = String(desiredIndex);
      }
    } catch {}

    const shouldAbortBecauseSuperseded = (): boolean => {
      try {
        if (!viewportEl || !(viewportEl as any).dataset) return false;
        const current = (viewportEl as any).dataset.__pendingStackRequestId ?? null;
        if (current !== requestToken) return true;
        const locked = (viewportEl as any).dataset?.__stackLocked ?? null;
        const lockedOwner = (viewportEl as any).dataset?.__stackLockedOwner ?? null;
        if (locked === '1' && lockedOwner && lockedOwner !== requestToken) return false;
        return false;
      } catch {
        return false;
      }
    };

    /* ----------------- preserveCurrentIndex guard (best-effort) ----------------- */
    try {
      if (preserveCurrentIndex && typeof desiredIndex === 'number' && desiredIndex === 0 && (viewportInstance || viewportEl)) {
        let currentImageId: string | null = null;

        try {
          if (
            viewportInstance &&
            typeof viewportInstance.getCurrentImageIdIndex === 'function' &&
            typeof viewportInstance.getImageIds === 'function'
          ) {
            const idx = Number(viewportInstance.getCurrentImageIdIndex?.() ?? -1);
            if (idx >= 0) {
              const vpIds = viewportInstance.getImageIds?.() ?? [];
              if (Array.isArray(vpIds) && vpIds[idx]) currentImageId = vpIds[idx];
            }
          } else if (viewportInstance && (viewportInstance as any).image && typeof (viewportInstance as any).image.imageId === 'string') {
            currentImageId = (viewportInstance as any).image.imageId;
          }
        } catch {}

        if (!currentImageId && viewportEl) {
          try {
            const en = getEnabledElementSafeLocal(viewportEl as HTMLDivElement | null);
            if (en) {
              if (en.image && typeof en.image.imageId === 'string') {
                currentImageId = en.image.imageId;
              } else if (en.viewport && typeof en.viewport.getCurrentImageIdIndex === 'function' && typeof en.viewport.getImageIds === 'function') {
                const idx = Number(en.viewport.getCurrentImageIdIndex?.() ?? -1);
                const ids = en.viewport.getImageIds?.() ?? [];
                if (idx >= 0 && Array.isArray(ids) && ids[idx]) currentImageId = ids[idx];
              } else if (typeof en.getCurrentImageIdIndex === 'function') {
                const idx = Number(en.getCurrentImageIdIndex?.() ?? -1);
                const ids = typeof en.getImageIds === 'function' ? en.getImageIds?.() ?? [] : [];
                if (idx >= 0 && Array.isArray(ids) && ids[idx]) currentImageId = ids[idx];
              }
            }
          } catch {}
        }

        if (currentImageId) {
          try {
            const curNorm = safeNormalizeId(currentImageId);
            const found = imageIds.findIndex((id) => safeNormalizeId(id) === curNorm);
            if (found >= 0) {
              desiredIndex = Math.max(0, Math.min(found, imageIds.length - 1));
            } else {
              desiredIndex = typeof params.desiredIndex === 'number' ? params.desiredIndex : 0;
            }
            pushViewerLog('stack.preserveCurrentIndex', { requestToken, currentImageId, found, desiredIndex });
            if (isDev) {
              console.debug('[stack.ensure] preserve check', {
                preserveCurrentIndex,
                currentImageId,
                foundIndex: found,
                finalDesiredIndex: desiredIndex,
                imageIdsLen: imageIds.length,
              });
            }
          } catch {
            desiredIndex = typeof params.desiredIndex === 'number' ? params.desiredIndex : 0;
          }
        } else {
          desiredIndex = typeof params.desiredIndex === 'number' ? params.desiredIndex : 0;
        }
      } else {
        desiredIndex = typeof params.desiredIndex === 'number' ? params.desiredIndex : 0;
      }
    } catch {
      desiredIndex = typeof params.desiredIndex === 'number' ? params.desiredIndex : 0;
    }

    /* ---------------------- USER COOLDOWN: avoid overriding user -------------- */
    try {
      const lastUserStr = (viewportEl as any)?.dataset?.__lastUserInteraction ?? null;
      const lastUserTs = lastUserStr ? Number(lastUserStr) : 0;
      const now = Date.now();

      if (lastUserTs && now - lastUserTs < USER_COOLDOWN_MS && desiredIndex === 0) {
        let currentIdx: number | null = null;

        try {
          if (viewportInstance) {
            if (typeof viewportInstance.getCurrentImageIdIndex === 'function') {
              currentIdx = Number(viewportInstance.getCurrentImageIdIndex?.() ?? -1);
            } else if (typeof (viewportInstance as any).getImageIdIndex === 'function') {
              currentIdx = Number((viewportInstance as any).getImageIdIndex?.() ?? -1);
            }
          }
        } catch {}

        if ((currentIdx == null || currentIdx < 0) && viewportEl) {
          try {
            const en = getEnabledElementSafeLocal(viewportEl as HTMLDivElement | null);
            if (en && en.viewport && typeof en.viewport.getCurrentImageIdIndex === 'function') {
              currentIdx = Number(en.viewport.getCurrentImageIdIndex?.() ?? -1);
            }
          } catch {}
        }

        if (typeof currentIdx === 'number' && currentIdx >= 0 && currentIdx !== desiredIndex) {
          pushViewerLog('stack.userCooldown.abort', { requestToken, lastUserTs, now, currentIdx, desiredIndex });
          if (isDev) {
            console.debug(
              `[stack] skipping attach because user interacted ${now - lastUserTs}ms ago, currentIdx=${currentIdx}, desired=${desiredIndex}`
            );
          }
          devLogFalse('user-cooldown');
          return false;
        }
      }
    } catch {
      // swallow
    }

    /* ----------------------- Helper: try attach or preload ---------------------- */
    async function tryAttachOrPreload(elToCheck: HTMLElement | null, idxToUse: number): Promise<boolean> {
      try {
        const en = getEnabledElementSafeLocal(elToCheck as HTMLDivElement | null);
        if (en && (en as any).image) {
          // enabled element already has image -> attempt to set stack/index on viewport/engine
          try {
            const vp = viewportInstance as any;
            const targetIdx = Math.max(0, Math.min(idxToUse, imageIds.length - 1));
            if (vp) {
              if (typeof vp.setImageIndex === 'function' || typeof vp.setStack === 'function') {
                // LOG before set
                pushViewerLog('stack.tryAttach.setStart', { requestToken, method: typeof vp.setStack === 'function' ? 'setStack' : 'setImageIndex', targetIdx });
                if (isDev) {
                  console.debug('[TRACE stack] about to set stack', {
                    method: typeof vp.setStack === 'function' ? 'setStack' : 'setImageIndex',
                    desiredIndex: targetIdx,
                    imageCount: imageIds.length,
                    requestToken,
                    viewportElTag: viewportEl?.tagName ?? null,
                  });
                }

                try {
                  if (typeof vp.setImageIndex === 'function') {
                    await vp.setImageIndex(targetIdx).catch(() => {});
                  } else if (typeof vp.setStack === 'function') {
                    await vp.setStack(imageIds, targetIdx).catch(() => {});
                  }
                  pushViewerLog('stack.tryAttach.setDone', { requestToken, targetIdx });
                } catch (err) {
                  pushViewerLog('stack.tryAttach.setError', { requestToken, targetIdx, err: String(err) });
                }
              }
            } else {
              const eng: any = renderingEngineRef?.current;
              const finalIdx = Math.max(0, Math.min(idxToUse, imageIds.length - 1));
              if (eng && typeof eng.setStacks === 'function') {
                pushViewerLog('stack.tryAttach.engineSetStart', { requestToken, finalIdx });
                try {
                  eng.setStacks([{ viewportId, imageIds, index: finalIdx }]);
                  pushViewerLog('stack.tryAttach.engineSetDone', { requestToken, finalIdx });
                } catch (err) {
                  pushViewerLog('stack.tryAttach.engineSetError', { requestToken, finalIdx, err: String(err) });
                }
              }
            }
          } catch (err) {
            pushViewerLog('stack.tryAttach.innerError', { requestToken, err: String(err) });
          }

          try {
            await forceRenderCheck(elToCheck as HTMLDivElement | null, viewportInstance, renderingEngineRef);
          } catch {}
          return true;
        } else {
          // enabled element doesn't have image -> try to preload the specific target
          try {
            const target = imageIds[Math.max(0, Math.min(idxToUse, imageIds.length - 1))];
            if (target) {
              pushViewerLog('stack.tryAttach.preloadSingle', { requestToken, target });
              await loadImageSafe(target).catch(() => {});
            }
          } catch (err) {
            pushViewerLog('stack.tryAttach.preloadSingleError', { requestToken, err: String(err) });
          }
        }
      } catch (err) {
        pushViewerLog('stack.tryAttach.outerError', { requestToken, err: String(err) });
      }
      return false;
    }

    /* ------------------- Optional quick ensureImageRendered path ------------------ */
    if (typeof ensureImageRendered === 'function' && viewportInstance && viewportEl) {
      try {
        const ok = await ensureImageRendered(viewportInstance, viewportEl, imageIds, desiredIndex, 40, 200).catch(() => false);
        pushViewerLog('stack.ensureImageRendered.result', { requestToken, ok });
        if (ok) {
          const elToCheck = viewportEl;
          if (await tryAttachOrPreload(elToCheck, desiredIndex)) return true;
        }
      } catch (e) {
        pushViewerLog('stack.ensureImageRendered.error', { requestToken, err: String(e) });
        if (isDev) {
          console.debug('[stack] ensureImageRendered threw', e);
        }
      }
    }

    /* ----------------------- Preload a few images (best-effort) ----------------------- */
    try {
      if (typeof preloadFn === 'function') {
        pushViewerLog('stack.preload.start', { requestToken, limit: 4 });
        await preloadFn(imageIds, { concurrency: 3, perLoadTimeoutMs: 6000, limit: 4 }).catch(() => {});
        pushViewerLog('stack.preload.done', { requestToken });
      } else {
        const tgt = imageIds[Math.max(0, Math.min(desiredIndex, imageIds.length - 1))];
        pushViewerLog('stack.preload.single', { requestToken, target: tgt });
        await loadImageSafe(tgt).catch(() => {});
      }
    } catch (e) {
      pushViewerLog('stack.preload.error', { requestToken, err: String(e) });
      if (isDev) {
        console.debug('[stack] preloadImagesWithTimeout failed', e);
      }
    }

    /* ----------------------- Aggressive attempts to attach stack ----------------------- */
    const attempts = ATTEMPTS_SETSTACK;

    for (let i = 0; i < attempts; i++) {
      pushViewerLog('stack.attempt.start', { requestToken, attempt: i + 1, desiredIndex, imageCount: imageIds.length });
      if (shouldAbortBecauseSuperseded()) {
        pushViewerLog('stack.attempt.abortedSuperseded', { requestToken, attempt: i + 1 });
        if (isDev) {
          console.debug('[stack.ensure] aborted: superseded by newer request or final-lock', { requestToken, attempt: i + 1 });
        }
        devLogFalse('concurrent-lock-or-superseded-or-final-lock');
        return false;
      }

      try {
        // a) try viewportInstance.setStack
        if (viewportInstance && typeof viewportInstance.setStack === 'function') {
          if (isDev) {
            console.debug('[TRACE stack] about to set stack', {
              method: 'setStack',
              desiredIndex,
              imageCount: imageIds.length,
              attempt: i + 1,
              requestToken,
              viewportElTag: viewportEl?.tagName ?? null,
            });
          }
          try {
            await viewportInstance.setStack(imageIds, desiredIndex).catch((e: any) => {
              throw e;
            });
            pushViewerLog('stack.attempt.setStack.done', { requestToken, attempt: i + 1 });
          } catch (err) {
            pushViewerLog('stack.attempt.setStack.error', { requestToken, attempt: i + 1, err: String(err) });
            throw err;
          }
        } else if (viewportInstance && (typeof viewportInstance.setImageId === 'function' || typeof viewportInstance.setImageIndex === 'function')) {
          if (isDev) {
            console.debug('[TRACE stack] about to set stack (setImageId/setImageIndex)', {
              desiredIndex,
              imageCount: imageIds.length,
              attempt: i + 1,
              requestToken,
            });
          }

          let currentIdx = -1;
          try {
            if (typeof viewportInstance.getCurrentImageIdIndex === 'function') {
              currentIdx = Number(viewportInstance.getCurrentImageIdIndex?.() ?? -1);
            } else if ((viewportInstance as any).image && typeof (viewportInstance as any).image.imageId === 'string') {
              const currentImageId = (viewportInstance as any).image.imageId;
              currentIdx = imageIds.findIndex((id) => String(id) === String(currentImageId));
            }
          } catch {}

          const finalIdx = Math.max(0, Math.min(desiredIndex, imageIds.length - 1));
          const preferIdx = typeof desiredIndex === 'number' && !Number.isNaN(desiredIndex) ? desiredIndex : (currentIdx >= 0 ? currentIdx : finalIdx);

          try {
            if (typeof viewportInstance.setImageId === 'function') {
              await viewportInstance.setImageId(imageIds[Math.max(0, Math.min(preferIdx, imageIds.length - 1))]).catch((e: any) => {
                throw e;
              });
            } else if (typeof viewportInstance.setImageIndex === 'function') {
              await viewportInstance.setImageIndex(preferIdx).catch((e: any) => {
                throw e;
              });
            } else {
              const eng: any = renderingEngineRef?.current;
              if (eng && typeof eng.setStacks === 'function') {
                eng.setStacks([{ viewportId, imageIds, index: preferIdx }]);
              }
            }
            pushViewerLog('stack.attempt.setImage.done', { requestToken, attempt: i + 1, preferIdx });
          } catch (err) {
            pushViewerLog('stack.attempt.setImage.error', { requestToken, attempt: i + 1, err: String(err) });
          }
        } else {
          const eng: any = renderingEngineRef?.current;
          if (eng && typeof eng.setStacks === 'function') {
            if (isDev) {
              console.debug('[TRACE stack] about to set stack (engine.setStacks fallback)', {
                desiredIndex,
                imageCount: imageIds.length,
                attempt: i + 1,
                requestToken,
                viewportElTag: viewportEl?.tagName ?? null,
              });
            }
            try {
              eng.setStacks([{ viewportId, imageIds, index: desiredIndex }]);
              pushViewerLog('stack.attempt.engineSet.done', { requestToken, attempt: i + 1 });
            } catch (err) {
              pushViewerLog('stack.attempt.engineSet.error', { requestToken, attempt: i + 1, err: String(err) });
            }
          }
        }
      } catch (err) {
        if (isDev) {
          console.debug(`[stack] attempt ${i + 1} setStack/setImageId failed`, err);
        }
      }

      // small wait then try to render
      try {
        await wait(100 + i * 30);
      } catch {}

      try { renderingEngineRef?.current?.resize?.(); } catch {}
      try { renderingEngineRef?.current?.renderViewport?.(viewportId); } catch {}
      try { await viewportInstance?.render?.(); } catch {}

      // check enabled element — if attached, tryAttachOrPreload returns true
      try {
        const elToCheck = viewportEl ?? (viewportInstance as any)?.element ?? null;
        if (await tryAttachOrPreload(elToCheck, desiredIndex)) {
          pushViewerLog('stack.attempt.attach.success', { requestToken, attempt: i + 1 });
          return true;
        }
      } catch {
        // ignore
      }

      // additional fallback: call engine.setStacks again to increase chance
      try {
        const eng: any = renderingEngineRef?.current;
        if (eng && typeof eng.setStacks === 'function') {
          try {
            pushViewerLog('stack.attempt.engineSet.retry', { requestToken, attempt: i + 1 });
            eng.setStacks([{ viewportId, imageIds, index: desiredIndex }]);
            renderingEngineRef?.current?.renderViewport?.(viewportId);
            pushViewerLog('stack.attempt.engineSet.retryDone', { requestToken, attempt: i + 1 });
          } catch (e) {
            pushViewerLog('stack.attempt.engineSet.retryError', { requestToken, attempt: i + 1, err: String(e) });
          }
        }
      } catch {}
    } // end attempts loop

    // Final settle + final check
    try {
      await wait(settleMs);
    } catch {}

    try { renderingEngineRef?.current?.resize?.(); } catch {}
    try { renderingEngineRef?.current?.renderViewport?.(viewportId); } catch {}
    try { await viewportInstance?.render?.(); } catch {}

    try {
      const elToCheck = viewportEl ?? (viewportInstance as any)?.element ?? null;
      if (await tryAttachOrPreload(elToCheck, desiredIndex)) {
        pushViewerLog('stack.finalCheck.attach.success', { requestToken });
        return true;
      }
    } catch (err) {
      pushViewerLog('stack.finalCheck.error', { requestToken, err: String(err) });
      if (isDev) {
        console.debug('[stack] final enabled check threw', err);
      }
    }

    try {
      const elToCheck = viewportEl ?? (viewportInstance as any)?.element ?? null;
      const en = getEnabledElementSafeLocal(elToCheck as HTMLDivElement | null);
      if (en) {
        let enIds: string[] | null = null;
        try {
          const vp = (en as any).viewport ?? null;
          if (vp && typeof vp.getImageIds === 'function') {
            enIds = vp.getImageIds?.() ?? null;
          } else if (typeof (en as any).getImageIds === 'function') {
            enIds = (en as any).getImageIds?.() ?? null;
          }
        } catch {}
        if (Array.isArray(enIds) && Array.isArray(imageIds) && enIds.length === imageIds.length) {
          try {
            const eq = (() => {
              const normalize = (s: any) =>
                String(normalizeId(String(s ?? '')) ?? '').replace(/^imageid:/i, '').split('?')[0];
              for (let i = 0; i < enIds.length; i++) {
                if (normalize(enIds[i]) !== normalize(imageIds[i])) return false;
              }
              return true;
            })();

            if (eq) {
              pushViewerLog('stack.finalCheck.enabledElementMatches', { requestToken });
              if (process.env.NODE_ENV === 'development') {
                console.debug('[stack.ensure] final-check succeeded: enabled element already holds same imageIds -> returning true');
              }
              return true;
            }
          } catch {}
        }

        try {
          if ((en as any).image) {
            pushViewerLog('stack.finalCheck.enabledHasImage', { requestToken });
            if (process.env.NODE_ENV === 'development') {
              console.debug('[stack.ensure] final-check: enabled.image exists (single image) -> returning true');
            }
            return true;
          }
        } catch {}
      }
    } catch (e) {
      // swallow
    }

    devLogFalse('final-failed-to-attach');
    return false;
  } finally {
    try {
      if (viewportInstance) {
        _ensuringMap.delete(viewportInstance);
      }
    } catch {}

    try {
      if (viewportEl && (viewportEl as any).dataset) {
        try {
          if ((viewportEl as any).dataset.__pendingStackRequestId === requestToken) {
            try { delete (viewportEl as any).dataset.__pendingStackRequestId; } catch {}
            try { delete (viewportEl as any).dataset.__pendingStackDesiredIndex; } catch {}
          }
        } catch {}
      }
    } catch {}
    pushViewerLog('stack.complete', { requestToken });
  }
}

export default {
  loadImageSafe,
  ensureStackOnViewport,
};
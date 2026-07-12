// src/hooks/useRenderingEngine.ts
'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { RenderingEngine, StackViewport, Enums as CoreEnums } from '@cornerstonejs/core';
import { ToolGroupManager } from '@cornerstonejs/tools';
import { initCornerstone } from '@/lib/cornerstone';
import { getRenderingEngine, RENDERER_ID } from '@/lib/cornerstone/renderer';
import voiLib from '@/lib/cornerstone/voi';
import { TOOL_GROUP } from '@/constants/toolgroup';
import { VIEWPORT_ID } from '@/constants/viewport';
import { enableElement } from '@/lib/cornerstone/element';
import { getEnabledElementSafeLocal } from '@/lib/viewer/dom';
import { normalizeCanvasAndContext, ensureCanvasSizing } from '@/lib/viewer/canvasUtils';
import { ATTEMPTS_ENGINE, USER_COOLDOWN_MS } from '@/lib/viewer/constants';

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForElement(ref: React.RefObject<HTMLElement | null>, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (ref.current) return ref.current;
    await sleep(50);
  }
  return null;
}

async function waitForVisibleSize(el: HTMLElement | null, timeout = 2000) {
  if (!el) return false;
  try {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
  } catch {}

  if (typeof ResizeObserver === 'undefined') {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await sleep(80);
      try {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return true;
      } catch {}
    }
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    let done = false;
    const ro = new ResizeObserver(() => {
      try {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && !done) {
          done = true;
          try {
            ro.disconnect();
          } catch {}
          resolve(true);
        }
      } catch {}
    });
    const t = window.setTimeout(() => {
      if (!done) {
        done = true;
        try {
          ro.disconnect();
        } catch {}
        resolve(false);
      }
    }, timeout);
    try {
      ro.observe(el);
    } catch (e) {
      clearTimeout(t);
      resolve(false);
    }
  });
}

/** Remove cornerstone canvases not inside mountEl to avoid confusion when picking enabled elements. */
function removeStrayCornerstoneCanvases(mountEl: HTMLElement | null) {
  try {
    const canvases = Array.from(document.querySelectorAll('canvas.cornerstone-canvas')) as HTMLCanvasElement[];
    for (const c of canvases) {
      try {
        if (!mountEl || !mountEl.contains(c)) {
          try {
            c.remove();
          } catch {
            try {
              c.style.display = 'none';
            } catch {}
          }
        }
      } catch {}
    }
  } catch {}
}

/** Safely detach any viewport from engine (best-effort). */
function tryDetachViewportSafely(engine: RenderingEngine | null, viewportId = VIEWPORT_ID) {
  try {
    if (!engine) return;
    if (typeof (engine as any).setViewports === 'function') {
      try {
        (engine as any).setViewports([]);
      } catch (e) {
      }
    }

    try {
      const oldVp = typeof (engine as any).getViewport === 'function' ? (engine as any).getViewport(viewportId) : null;
      if (oldVp && typeof (oldVp as any).setElement === 'function') {
        try {
          (oldVp as any).setElement(null);
        } catch (e) {
        }
      }
    } catch (e) {
    }
  } catch (e) {
  }
}

/** Normalize imageId-like strings for comparisons. */
function normalizeForCompare(id: any) {
  try {
    return String(id ?? '')
      .replace(/^imageid:/i, '')
      .split('?')[0]
      .toLowerCase();
  } catch {
    return String(id ?? '');
  }
}

function imageListsEqual(a?: any[], b?: any[]) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (normalizeForCompare(a[i]) !== normalizeForCompare(b[i])) return false;
  }
  return true;
}

export function useRenderingEngine({
  elRef,
  selectedSeriesId,
  mergedSeriesMap,
  voiDefaults,
  onFrameIndexChange,
  viewportBackground,
}: {
  elRef: React.RefObject<HTMLDivElement | null>;
  selectedSeriesId: string;
  mergedSeriesMap: Record<string, { files: string[]; metadata: any }>;
  voiDefaults: Record<string, { lower: number; upper: number }>;
  onFrameIndexChange?: (index: number) => void;
  viewportBackground?: [number, number, number];
}) {
  const renderingEngineRef = useRef<RenderingEngine | null>(null);
  const [viewportInstance, setViewportInstance] = useState<StackViewport | null>(null);
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);

  const stackEventHandlerRef = useRef<((e: any) => void) | null>(null);
  const watchdogTimerRef = useRef<number | null>(null);

  const initTokenRef = useRef<symbol | null>(null);
  const cleanupTimerRef = useRef<number | null>(null);

  const lastImageIndexRef = useRef<number | null>(null);
  const previousSeriesIdRef = useRef<string | null>(null);

  const imageFilesJson = useMemo(() => {
    try {
      return JSON.stringify(mergedSeriesMap?.[selectedSeriesId]?.files ?? []);
    } catch {
      return '[]';
    }
  }, [selectedSeriesId, mergedSeriesMap]);

  const forceRenderFrames = async (frames = 3, vpLocal?: any) => {
    try {
      const eng = renderingEngineRef.current;
      let count = 0;
      const doOne = async () => {
        try {
          if (vpLocal && vpLocal.element && (vpLocal.element as HTMLElement).isConnected && typeof vpLocal.render === 'function') {
            try {
              await (vpLocal.render() as Promise<any>);
            } catch {}
          }
          try {
            if (eng && typeof (eng as any).renderViewport === 'function') (eng as any).renderViewport?.(VIEWPORT_ID);
          } catch {}
        } catch {}
      };
      const loop = () => {
        if (count >= frames) return;
        count += 1;
        void doOne();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    } catch (e) {
    }
  };

  async function waitForEnabledImage(el: HTMLElement | null, vpLocal: any, timeoutMs = 3000, intervalMs = 120): Promise<boolean> {
    const start = Date.now();
    const csCore: any = (window as any).__cornerstoneCore ?? null;

    const getEnabled = () => {
      try {
        if (csCore?.getEnabledElementByViewportId) {
          try {
            return csCore.getEnabledElementByViewportId(VIEWPORT_ID);
          } catch {}
        }
        if (csCore?.getEnabledElement) {
          try {
            return csCore.getEnabledElement(vpLocal?.element ?? el);
          } catch {}
        }
        try {
          if (typeof getEnabledElementSafeLocal === 'function') {
            return getEnabledElementSafeLocal(vpLocal?.element ?? el);
          }
        } catch {}
      } catch {}
      return null;
    };

    const checkOnce = () => {
      try {
        const en = getEnabled();
        if (en && (en as any).image) return true;
        return false;
      } catch {
        return false;
      }
    };

    if (checkOnce()) return true;

    while (Date.now() - start < timeoutMs) {
      try {
        try {
          const candidateEl = vpLocal?.element ?? el;
          if (candidateEl) {
            try { enableElement(candidateEl); } catch {}

            let enabledCandidate: any = null;
            try {
              enabledCandidate = getEnabled();
            } catch {}
            const hasImageOnEnabled = Boolean(enabledCandidate && (enabledCandidate as any).image);
            const vpReportsImages =
              Boolean(vpLocal && typeof vpLocal.getImageIds === 'function' && Array.isArray(vpLocal.getImageIds?.()) && (vpLocal.getImageIds() || []).length > 0);

            if (hasImageOnEnabled || vpReportsImages) {
              try { vpLocal?.render?.(); } catch {}
              try { renderingEngineRef.current?.resize?.(); } catch {}
              try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
            }

            try { normalizeCanvasAndContext(candidateEl); } catch {}
          }
        } catch {}

        try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
        try { await forceRenderFrames(1, vpLocal); } catch {}

        if (checkOnce()) return true;
      } catch {}
      await sleep(intervalMs);
    }

    try { return checkOnce(); } catch { return false; }
  }

  useEffect(() => {
    if (!selectedSeriesId) return;
    const shouldPreserveInitialIndex = previousSeriesIdRef.current === selectedSeriesId;
    if (!shouldPreserveInitialIndex) {
      lastImageIndexRef.current = null;
    }
    previousSeriesIdRef.current = selectedSeriesId;

    const myToken = Symbol('init');
    initTokenRef.current = myToken;

    try {
      if (cleanupTimerRef.current) {
        window.clearTimeout(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }
    } catch {}

    const cancelled = false;
    let engine: any = null;
    let vp: any = null;

    (async () => {
      try {
        await initCornerstone();
      } catch (err) {}

      try {
        engine = getRenderingEngine(RENDERER_ID);
        renderingEngineRef.current = engine;
      } catch (err) {}

      tryDetachViewportSafely(renderingEngineRef.current);

      const container = (elRef.current ?? (await waitForElement(elRef, 5000))) as HTMLDivElement | null;
      if (!container || cancelled) return;

      try {
        container.setAttribute('data-viewport-uid', VIEWPORT_ID);
      } catch {}

      let mountEl: HTMLDivElement | null = null;
      try {
        const inner = container.querySelector?.('.viewport-element') ?? container.querySelector?.('[data-viewport-role="content"]');
        mountEl = inner instanceof HTMLElement ? (inner as HTMLDivElement) : container;
      } catch {
        mountEl = container;
      }

      try { enableElement(mountEl); } catch {}
      try { normalizeCanvasAndContext(mountEl); } catch {}

      const viewportType = (CoreEnums as any)?.ViewportType?.STACK ?? (CoreEnums as any)?.ViewportType?.Stack ?? (CoreEnums as any)?.ViewportType?.stack ?? 'stack';

      const visible = await waitForVisibleSize(mountEl, 2000);
      if (!visible && cancelled) return;

      try {
        tryDetachViewportSafely(renderingEngineRef.current);
        await sleep(80);

        try {
          await engine.setViewports?.([{
            viewportId: VIEWPORT_ID,
            type: viewportType,
            element: mountEl,
            defaultOptions: {
              background: viewportBackground ?? [0, 0, 0],
            },
          }]);
        } catch (err) {}

        try { normalizeCanvasAndContext(mountEl); } catch {}
        try { ensureCanvasSizing(mountEl); } catch {}

        try { removeStrayCornerstoneCanvases(mountEl); } catch {}

        await sleep(60);

        try { renderingEngineRef.current?.resize?.(); } catch {}
        try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
      } catch (err) {}

      try { vp = engine.getViewport?.(VIEWPORT_ID); } catch {}
      if (!vp) {
        for (let i = 0; i < 6 && !vp && !cancelled; i++) {
          await sleep(80);
          try { vp = engine.getViewport?.(VIEWPORT_ID); } catch {}
        }
      }

      // --- wrap setStack / setImageId to avoid stomping after recent user interaction ---
      try {
        if (vp) {
          try {
            const origSetStack = (vp as any).setStack;
            if (typeof origSetStack === 'function') {
              (vp as any).setStack = async function wrappedVpSetStack(imageIds: string[], idx: number) {
                try {
                  const el = (vp as any).element ?? mountEl ?? document.querySelector(`[data-viewport-uid="${VIEWPORT_ID}"]`);
                  let lastUserTs = 0;
                  try { lastUserTs = Number((el as HTMLElement)?.dataset?.__lastUserInteraction ?? 0) || 0; } catch {}
                  const now = Date.now();
                  const targetIndex = Number.isFinite(Number(idx)) ? Number(idx) : 0;

                  if (lastUserTs && now - lastUserTs < USER_COOLDOWN_MS) {
                    let currentIdx = -1;
                    try { if (typeof (vp as any).getCurrentImageIdIndex === 'function') currentIdx = (vp as any).getCurrentImageIdIndex(); } catch {}
                    if (currentIdx >= 0 && currentIdx !== targetIndex) {
                      return false;
                    }
                  }
                } catch {}
                // eslint-disable-next-line prefer-rest-params
                return await (origSetStack as any).apply(this, arguments as any);
              };
            }
          } catch {}

          try {
            const origSetImageId = (vp as any).setImageId;
            if (typeof origSetImageId === 'function') {
              (vp as any).setImageId = async function wrappedSetImageId(id: string) {
                try {
                  const el = (vp as any).element ?? mountEl ?? document.querySelector(`[data-viewport-uid="${VIEWPORT_ID}"]`);
                  let lastUserTs = 0;
                  try { lastUserTs = Number((el as HTMLElement)?.dataset?.__lastUserInteraction ?? 0) || 0; } catch {}
                  const now = Date.now();
                  if (lastUserTs && now - lastUserTs < USER_COOLDOWN_MS) {
                    try {
                      const ids = (vp as any).getImageIds?.() ?? [];
                      const currentIdx = (typeof (vp as any).getCurrentImageIdIndex === 'function') ? (vp as any).getCurrentImageIdIndex() : -1;
                      const targetIdx = ids.findIndex((x: string) => String(x) === String(id));
                      if (currentIdx >= 0 && targetIdx >= 0 && currentIdx !== targetIdx) {
                        return false;
                      }
                    } catch {}
                  }
                } catch {}
                // eslint-disable-next-line prefer-rest-params
                return await (origSetImageId as any).apply(this, arguments as any);
              };
            }
          } catch {}
        }
      } catch {}

      try { enableElement((vp?.element as HTMLElement) ?? mountEl); } catch {}
      try { normalizeCanvasAndContext((vp?.element as HTMLElement) ?? mountEl); } catch {}

      // register viewport with tool group
      try {
        const tg = ToolGroupManager.getToolGroup(TOOL_GROUP);
        if (tg && engine?.id) {
          const present = (typeof (tg as any).getViewportIds === 'function' ? tg.getViewportIds() : typeof (tg as any).getViewports === 'function' ? (tg as any).getViewports() : []) ?? [];
          if (!present.includes?.(VIEWPORT_ID)) {
            try { tg.addViewport(VIEWPORT_ID, engine.id); } catch {}
          }
        }
      } catch {}

      const imageIds = mergedSeriesMap[selectedSeriesId]?.files ?? [];
      const initialIndex = 0;

      async function robustSetStack(vpCandidate: any, ids: string[], idx = 0) {
        if (!ids || ids.length === 0) return false;

        try {
          const currentIds = vpCandidate && typeof vpCandidate.getImageIds === 'function' ? vpCandidate.getImageIds() : null;
          const currentIdx = vpCandidate && typeof vpCandidate.getCurrentImageIdIndex === 'function' ? vpCandidate.getCurrentImageIdIndex() : null;
          if (Array.isArray(currentIds) && currentIds.length && imageListsEqual(currentIds, ids) && typeof currentIdx === 'number' && currentIdx === idx) {
            return true;
          }
        } catch {}

        const reqToken = `stk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const elForLock = (vpCandidate?.element as HTMLElement) ?? mountEl ?? document.querySelector(`[data-viewport-uid="${VIEWPORT_ID}"]`);
        try {
          if (elForLock && elForLock instanceof HTMLElement) {
            elForLock.dataset.__stackLocked = '1';
            elForLock.dataset.__stackLockedOwner = reqToken;
          }
        } catch {}

        const attempts = ATTEMPTS_ENGINE;
        for (let i = 0; i < attempts && !cancelled; i++) {
          try {
            if (vpCandidate && typeof vpCandidate.setStack === 'function') {
              await vpCandidate.setStack(ids, idx);
            } else if (vpCandidate && typeof vpCandidate.setImageId === 'function') {
              await vpCandidate.setImageId(ids[idx]);
            } else if (renderingEngineRef.current && typeof (renderingEngineRef.current as any).setStacks === 'function') {
              (renderingEngineRef.current as any).setStacks([{ viewportId: VIEWPORT_ID, imageIds: ids, index: idx, __requestToken: reqToken }]);
            } else {
              return true;
            }

            try {
              if (vpCandidate && typeof vpCandidate.setImageIndex === 'function') {
                vpCandidate.setImageIndex(idx);
              } else if (vpCandidate && typeof vpCandidate.getImageIds === 'function') {
                const idsLocal = vpCandidate.getImageIds?.() ?? [];
                if (idsLocal && idsLocal.length) {
                  const safeIdx = Math.max(0, Math.min(idx, idsLocal.length - 1));
                  try { vpCandidate.setImageId?.(idsLocal[safeIdx]); } catch {}
                }
              }
            } catch (e) {}

            try { normalizeCanvasAndContext((vpCandidate?.element as HTMLElement) ?? mountEl); } catch {}
            try { renderingEngineRef.current?.resize?.(); } catch {}
            try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
            try { if (typeof (vpCandidate?.render) === 'function') await vpCandidate.render(); } catch {}
            try { await forceRenderFrames(2, vpCandidate); } catch {}
            return true;
          } catch (err) {
            await sleep(120 * (i + 1));
          }
        }

        try {
          if (elForLock && elForLock instanceof HTMLElement) {
            delete elForLock.dataset.__stackLocked;
            delete elForLock.dataset.__stackLockedOwner;
          }
        } catch {}

        return false;
      }

      async function performFallbackAttach(ids: string[]) {
        try {
          const csCore: any = (window as any).__cornerstoneCore ?? null;
          const preferIdx =
            shouldPreserveInitialIndex && typeof lastImageIndexRef.current === 'number'
              ? lastImageIndexRef.current
              : initialIndex;
          const chosenIndex = Math.max(0, Math.min(preferIdx, Math.max(0, (ids?.length ?? 1) - 1)));

          const reqToken = `stk-fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const elForLock = vp?.element ?? mountEl ?? document.querySelector(`[data-viewport-uid="${VIEWPORT_ID}"]`);
          try {
            if (elForLock && elForLock instanceof HTMLElement) {
              elForLock.dataset.__stackLocked = '1';
              elForLock.dataset.__stackLockedOwner = reqToken;
            }
          } catch (e) {}

          try {
            if (renderingEngineRef.current && typeof (renderingEngineRef.current as any).setStacks === 'function') {
              (renderingEngineRef.current as any).setStacks([{ viewportId: VIEWPORT_ID, imageIds: ids, index: chosenIndex, __requestToken: reqToken }]);
            }
          } catch (e) {}

          try {
            if (csCore && typeof csCore.addImageSlicesToViewports === 'function') {
              try {
                csCore.addImageSlicesToViewports([{ viewportId: VIEWPORT_ID, imageIds: ids }]);
              } catch (e) {
                try {
                  csCore.addImageSlicesToViewports(VIEWPORT_ID, ids);
                } catch (e2) {}
              }
            }
          } catch (e) {}

          try {
            const first = ids[chosenIndex] ?? ids[0];
            if (first) {
              const win: any = window;
              const globalFn = win?.__cornerstoneImageLoaderFn ?? null;
              if (typeof globalFn === 'function') {
                await globalFn(first).catch(() => {});
              } else if (csCore && csCore.imageLoader && typeof csCore.imageLoader.loadAndCacheImage === 'function') {
                await csCore.imageLoader.loadAndCacheImage(first).catch(() => {});
              }
            }
          } catch (e) {}

          try {
            const eventName = (CoreEnums as any)?.Events?.STACK_NEW_IMAGE ?? 'cornerstone-stack-new-image';
            const detail = { imageIdIndex: chosenIndex };
            const targetEl = (vp?.element ?? document.querySelector(`[data-viewport-uid="${VIEWPORT_ID}"]`)) as HTMLElement | null;
            try {
              targetEl?.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true }));
            } catch (e) {}
          } catch (e) {}

          try { await forceRenderFrames(4, vp); } catch (e) {}
          try { normalizeCanvasAndContext((vp?.element as HTMLElement) ?? document.querySelector(`[data-viewport-uid="${VIEWPORT_ID}"]`)); } catch {}
          try { renderingEngineRef.current?.resize?.(); } catch {}
          try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
          try { await vp?.render?.(); } catch {}

        } catch (e) {} finally {
          try {
            const elForLock = vp?.element ?? mountEl ?? document.querySelector(`[data-viewport-uid="${VIEWPORT_ID}"]`);
            if (elForLock && elForLock instanceof HTMLElement) {
              delete elForLock.dataset.__stackLocked;
              delete elForLock.dataset.__stackLockedOwner;
            }
          } catch (e) {}
        }
      }

      if (vp && imageIds && imageIds.length > 0) {
        try {
          const preferIdx =
            shouldPreserveInitialIndex && typeof lastImageIndexRef.current === 'number'
              ? lastImageIndexRef.current
              : initialIndex;
          const safePreferIdx = Math.max(0, Math.min(preferIdx, (imageIds?.length ?? 1) - 1));

          const ok = await robustSetStack(vp, imageIds, safePreferIdx);

          try { vp.reset?.(); } catch {}
          try { renderingEngineRef.current?.resize?.(); } catch {}
          try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
          try { normalizeCanvasAndContext((vp?.element as HTMLElement) ?? mountEl); } catch {}

          const elToCheck = (vp?.element ?? mountEl) as HTMLDivElement | null;
          const attachedOk = await waitForEnabledImage(elToCheck, vp, 3000, 120);

          if (!attachedOk) {
            await performFallbackAttach(imageIds);
          }

          try {
            const polling = await import('@/lib/viewer/polling');
            if (polling?.forceRenderCheck) {
              try { await polling.forceRenderCheck(elToCheck as HTMLDivElement, vp, renderingEngineRef); } catch {}
            }
          } catch (e) {}

          try {
            setTimeout(async () => {
              try {
                const polling = await import('@/lib/viewer/polling');
                if (polling?.forceRenderCheck) {
                  await polling.forceRenderCheck(elToCheck as HTMLDivElement, vp, renderingEngineRef);
                }
              } catch {}
            }, 300);
          } catch {}

          try {
            setTimeout(async () => {
              try {
                const polling = await import('@/lib/viewer/polling');
                if (polling?.forceRenderCheck) {
                  await polling.forceRenderCheck(elToCheck as HTMLDivElement, vp, renderingEngineRef);
                }
              } catch {}
            }, 900);
          } catch {}

          function startWatchdog(missThreshold = 5, intervalMs = 800, cooldownMs = 8000) {
            try {
              try { if (watchdogTimerRef.current) { window.clearInterval(watchdogTimerRef.current); watchdogTimerRef.current = null; } } catch {}
              let missCount = 0;
              let lastReattachTs = 0;

              const id = window.setInterval(async () => {
                try {
                  const elToCheck = (vp?.element ?? (document.querySelector(`[data-viewport-uid="${VIEWPORT_ID}"]`))) as HTMLDivElement | null;
                  if (!elToCheck) { missCount = 0; return; }
                  if (!(elToCheck as HTMLElement).isConnected) { missCount = 0; return; }

                  const csCore: any = (window as any).__cornerstoneCore ?? null;
                  let enabled: any = null;
                  try { if (csCore?.getEnabledElementByViewportId) enabled = csCore.getEnabledElementByViewportId(VIEWPORT_ID); else if (csCore?.getEnabledElement) enabled = csCore.getEnabledElement(elToCheck); else enabled = (typeof getEnabledElementSafeLocal === 'function') ? getEnabledElementSafeLocal(elToCheck) : null; } catch (e) { enabled = null; }

                  const activeViewport =
                    (enabled as any)?.viewport ??
                    vp ??
                    renderingEngineRef.current?.getViewport?.(VIEWPORT_ID) ??
                    null;
                  let imageExists = Boolean((enabled as any)?.image);
                  try {
                    imageExists = imageExists || Boolean(activeViewport?.getCurrentImageId?.());
                  } catch {}
                  try {
                    imageExists = imageExists || Boolean(activeViewport?.getCornerstoneImage?.());
                  } catch {}
                  try {
                    imageExists = imageExists || Boolean(activeViewport?.getImageData?.());
                  } catch {}
                  try {
                    imageExists =
                      imageExists ||
                      String(activeViewport?.viewportStatus ?? '').toLowerCase() === 'rendered';
                  } catch {}
                  if (imageExists) { missCount = 0; return; }

                  missCount += 1;

                  const now = Date.now();
                  if (now - lastReattachTs < cooldownMs) { return; }

                  if (missCount >= missThreshold) {
                    lastReattachTs = Date.now();
                    try {
                      if (vp && typeof vp.setImageIndex === 'function') {
                        const idx = typeof vp.getCurrentImageIdIndex === 'function' ? (vp.getCurrentImageIdIndex() ?? 0) : 0;
                        try { 
                          vp.setImageIndex(idx);
                        } catch (e) {}
                      } else if (vp && typeof vp.getImageIds === 'function') {
                        const ids = vp.getImageIds?.() ?? [];
                        if (ids && ids.length) {
                          try {
                            let currentIdx = -1;
                            try { if (typeof (vp as any).getCurrentImageIdIndex === 'function') currentIdx = (vp as any).getCurrentImageIdIndex(); } catch {}
                            const safeIdx = (typeof currentIdx === 'number' && currentIdx >= 0)
                              ? currentIdx
                              : (shouldPreserveInitialIndex && typeof lastImageIndexRef.current === 'number' ? lastImageIndexRef.current : -1);

                            if (safeIdx >= 0 && typeof vp.setImageIndex === 'function') {
                              try {
                                vp.setImageIndex(safeIdx);
                              } catch (e) {
                                try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
                              }
                            } else {
                              try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch (e) {}
                            }
                          } catch (e) {}
                        }
                      } else {
                        await performFallbackAttach(mergedSeriesMap[selectedSeriesId]?.files ?? []);
                      }

                      try { await forceRenderFrames(3, vp); } catch (e) {}
                      try { normalizeCanvasAndContext((vp?.element as HTMLElement) ?? document.querySelector(`[data-viewport-uid="${VIEWPORT_ID}"]`)); } catch {}
                    } catch (e) {} finally { missCount = 0; }
                  }
                } catch (err) {}
              }, intervalMs);

              watchdogTimerRef.current = id;
            } catch (e) {}
          }

          startWatchdog();
        } catch (e) {}
      }

      // apply VOI defaults (if provided)
      try {
        const seriesDefault = selectedSeriesId && (voiDefaults[selectedSeriesId] ?? null);
        if (vp && seriesDefault) {
          try { vp.setProperties?.({ voiRange: seriesDefault }); } catch {}
          try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
        }
      } catch (err) {}

      const onStackNewImage = (e: any) => {
        try {
          const idx = typeof e?.detail?.imageIdIndex === 'number' ? e.detail.imageIdIndex : 0;

          if (onFrameIndexChange) onFrameIndexChange(idx + 1);

          try {
            if (typeof idx === 'number' && !Number.isNaN(idx)) {
              lastImageIndexRef.current = idx;
            }
          } catch {}

          // compute/apply VOI only for the initialIndex (heavy)
          if (idx !== initialIndex) return;

          (async () => {
            try {
              const imgId = vp?.getImageIds?.()?.[idx];
              if (!imgId) return;

              if (voiDefaults[selectedSeriesId]) return;

              try {
                if (voiLib && (voiLib as any).cacheVOI?.has?.(String(imgId))) {
                  const cached = (voiLib as any).cacheVOI.get(String(imgId));
                  if (cached) {
                    try { vp.setProperties?.({ voiRange: cached }); } catch {}
                    try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
                    return;
                  }
                }
              } catch {}

              try {
                if (voiLib && typeof (voiLib as any).applyVOI === 'function') {
                  await (voiLib as any).applyVOI(vp, imgId, {
                    persistTo: (v: any) => {
                      try {
                        (voiLib as any).cacheVOI.set(String(imgId), v);
                      } catch {}
                    },
                  }).catch(() => {});
                  try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
                }
              } catch (err) {
              }
            } catch (err) {}
          })();
        } catch (err) {}
      };

      stackEventHandlerRef.current = onStackNewImage;
      try {
        if (vp?.element && (CoreEnums as any)?.Events) {
          vp.element.addEventListener((CoreEnums as any).Events?.STACK_NEW_IMAGE ?? 'cornerstone-stack-new-image', onStackNewImage as any);
        } else {
          mountEl?.addEventListener('cornerstone-stack-new-image', onStackNewImage as any);
        }
      } catch (e) {}

      if (!cancelled && initTokenRef.current === myToken) {
        setViewportInstance(vp ?? null);
        setViewportEl((vp?.element as HTMLDivElement) ?? mountEl);
      }
    })();

    // cleanup
    return () => {
      const cancelledLocal = true;
      const tokenAtCleanup = initTokenRef.current;
      const delayMs = 120;

      try {
        cleanupTimerRef.current = window.setTimeout(() => {
          try {
            if (initTokenRef.current !== tokenAtCleanup) return;

            try { if (watchdogTimerRef.current) { window.clearInterval(watchdogTimerRef.current); watchdogTimerRef.current = null; } } catch (e) {}

            try {
              const handler = stackEventHandlerRef.current;
              if (handler) {
                const elToRemove = (renderingEngineRef.current?.getViewport?.(VIEWPORT_ID)?.element ?? elRef.current);
                try { elToRemove?.removeEventListener((CoreEnums as any).Events?.STACK_NEW_IMAGE ?? 'cornerstone-stack-new-image', handler as any); } catch (e) {}
                try { elToRemove?.removeEventListener('cornerstone-stack-new-image', handler as any); } catch (e) {}
              }
            } catch (e) {}

            try { const tg = ToolGroupManager.getToolGroup(TOOL_GROUP); if (tg && typeof (tg as any).removeViewports === 'function') { try { (tg as any).removeViewports?.([VIEWPORT_ID]); } catch (e) {} } else if (tg && typeof (tg as any).removeViewport === 'function') { try { (tg as any).removeViewport?.(VIEWPORT_ID); } catch (e) {} } } catch (e) {}

            try {
              tryDetachViewportSafely(renderingEngineRef.current);
            } catch (e) {}

            setViewportInstance(null);
            setViewportEl(null);
            stackEventHandlerRef.current = null;
          } catch (outer) {} finally { cleanupTimerRef.current = null; }
        }, delayMs);
      } catch (e) {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeriesId, imageFilesJson, voiDefaults, elRef, viewportBackground]);

  return { renderingEngineRef, viewportInstance, viewportEl };
}

export default useRenderingEngine;

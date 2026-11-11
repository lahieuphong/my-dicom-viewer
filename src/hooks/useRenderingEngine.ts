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
import { ATTEMPTS_ENGINE } from '@/lib/viewer/constants';
import { areImageStacksEqual } from '@/lib/cornerstone/helpers';
import { resizeEngineIfNeeded } from '@/lib/viewer/fitViewport';
import { resetViewportCamera } from '@/lib/viewer/viewportActions';

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const VIEWPORT_BACKGROUND: [number, number, number] = [0, 0, 0];

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
        const owningViewport = c.closest<HTMLElement>(
          '[data-viewport-role="content"]'
        );
        // A split layout intentionally has multiple Cornerstone canvases in
        // the same rendering engine. Preserve every connected viewer-owned
        // viewport and only remove genuinely detached/legacy canvases.
        if (
          owningViewport &&
          owningViewport.isConnected &&
          owningViewport !== mountEl
        ) {
          continue;
        }
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
    // setViewports([]) resets the *entire* rendering engine and therefore also
    // destroys sibling panes in a split layout. Disable only the requested
    // viewport; every pane owns its own lifecycle.
    try { engine.disableElement(viewportId); } catch {}
  } catch (e) {
  }
}

export function useRenderingEngine({
  elRef,
  selectedSeriesId,
  mergedSeriesMap,
  voiDefaults,
  onFrameIndexChange,
}: {
  elRef: React.RefObject<HTMLDivElement | null>;
  selectedSeriesId: string;
  mergedSeriesMap: Record<string, { files: string[]; metadata: any }>;
  voiDefaults: Record<string, { lower: number; upper: number }>;
  onFrameIndexChange?: (index: number) => void;
}) {
  const renderingEngineRef = useRef<RenderingEngine | null>(null);
  const [viewportInstance, setViewportInstance] = useState<StackViewport | null>(null);
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);

  const stackEventHandlerRef = useRef<((e: any) => void) | null>(null);

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

    // Cornerstone 3D enabled elements expose `viewport`, not the legacy
    // Cornerstone 2D `image` field, so checking `enabled.image` never
    // succeeded: every attach polled for the full timeout and then ran the
    // fallback attach. The stack is ready once its current image rendered.
    const checkOnce = () => {
      try {
        const viewport = getEnabled()?.viewport ?? vpLocal;
        return (
          Boolean(viewport?.getCurrentImageId?.()) &&
          String(viewport?.viewportStatus ?? '').toLowerCase() === 'rendered'
        );
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

            const vpReportsImages =
              Boolean(vpLocal && typeof vpLocal.getImageIds === 'function' && Array.isArray(vpLocal.getImageIds?.()) && (vpLocal.getImageIds() || []).length > 0);

            // Nudge rendering only. Resizing here cleared every pane's canvas
            // on each poll and fought panel drags and layout fits; canvas
            // sizing is owned by the viewport auto-fit and grid resize hooks.
            if (vpReportsImages) {
              try { vpLocal?.render?.(); } catch {}
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

    // A series switch reuses the same DOM element and rendering engine. Cancel
    // per-series observers immediately so the next stack gets one clean set of
    // listeners without tearing down the viewport itself.
    try {
      const previousHandler = stackEventHandlerRef.current;
      const previousElement =
        renderingEngineRef.current?.getViewport?.(VIEWPORT_ID)?.element ??
        elRef.current;
      if (previousHandler && previousElement) {
        previousElement.removeEventListener(
          CoreEnums.Events.STACK_NEW_IMAGE,
          previousHandler as EventListener
        );
      }
      stackEventHandlerRef.current = null;
    } catch {}

    let cancelled = false;
    let engine: any = null;
    let vp: any = null;
    const isStale = () => cancelled || initTokenRef.current !== myToken;

    (async () => {
      try {
        await initCornerstone();
      } catch (err) {}
      if (isStale()) return;

      try {
        engine = getRenderingEngine(RENDERER_ID);
        renderingEngineRef.current = engine;
      } catch (err) {}
      if (isStale()) return;

      const container = (elRef.current ?? (await waitForElement(elRef, 5000))) as HTMLDivElement | null;
      if (!container || isStale()) return;

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

      await waitForVisibleSize(mountEl, 2000);
      if (isStale()) return;

      let reuseExistingViewport = false;
      try {
        const existingViewport = engine.getViewport?.(VIEWPORT_ID) ?? null;
        const existingElement = existingViewport?.element as HTMLDivElement | undefined;
        const sharesViewerMount = Boolean(
          existingElement &&
          (existingElement === mountEl ||
            container.contains(existingElement) ||
            existingElement.contains(container))
        );
        if (
          existingViewport &&
          existingElement?.isConnected &&
          sharesViewerMount
        ) {
          vp = existingViewport;
          mountEl = existingElement;
          reuseExistingViewport = true;
        }
      } catch {}

      try {
        if (isStale()) return;
        if (!reuseExistingViewport) {
          tryDetachViewportSafely(renderingEngineRef.current);
          await sleep(80);
          if (isStale()) return;

          try {
            // `setViewports([primary])` replaces the complete RenderingEngine
            // viewport list. During a restored split layout that could remove
            // every secondary viewport which had just mounted. Enable only
            // this viewport so sibling panes keep their canvases and stacks.
            engine.enableElement?.({
              viewportId: VIEWPORT_ID,
              type: viewportType,
              element: mountEl,
              defaultOptions: {
                background: VIEWPORT_BACKGROUND,
              },
            });
          } catch (err) {}
          if (isStale()) return;
        }

        try { normalizeCanvasAndContext(mountEl); } catch {}
        try { ensureCanvasSizing(mountEl); } catch {}

        try { removeStrayCornerstoneCanvases(mountEl); } catch {}

        await sleep(60);
        if (isStale()) return;

        try { resizeEngineIfNeeded(renderingEngineRef.current); } catch {}
        try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
      } catch (err) {}

      if (!vp) {
        try { vp = engine.getViewport?.(VIEWPORT_ID); } catch {}
      }
      if (!vp) {
        for (let i = 0; i < 6 && !vp && !isStale(); i++) {
          await sleep(80);
          try { vp = engine.getViewport?.(VIEWPORT_ID); } catch {}
        }
      }
      if (isStale()) return;

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

      /** 'kept' when the viewport already showed the stack, 'set' when it was set. */
      async function robustSetStack(
        vpCandidate: any,
        ids: string[],
        idx = 0
      ): Promise<'kept' | 'set' | 'failed'> {
        if (!ids || ids.length === 0) return 'failed';

        try {
          const currentIds = vpCandidate?.getImageIds?.();
          if (
            Array.isArray(currentIds) &&
            currentIds.length > 0 &&
            areImageStacksEqual(currentIds, ids)
          ) {
            // The effect re-runs for the series already shown when its VOI
            // defaults arrive. Setting the same stack again would move the
            // user back to the remembered index and reset the view; this
            // replaces the former "3 s after a user interaction" setStack
            // wrapper, which only covered re-runs right after a gesture.
            if (shouldPreserveInitialIndex) return 'kept';
            if (vpCandidate.getCurrentImageIdIndex?.() === idx) return 'kept';
          }
        } catch {}

        const attempts = ATTEMPTS_ENGINE;
        for (let i = 0; i < attempts && !isStale(); i++) {
          try {
            // setStack(imageIds, index) loads and shows the image at `index`.
            // Cornerstone 3D has no StackViewport.setImageId/setImageIndex or
            // RenderingEngine.setStacks, so the former fallbacks never ran.
            if (typeof vpCandidate?.setStack !== 'function') return 'failed';
            await vpCandidate.setStack(ids, idx);
            // A newly selected series opens in the default orientation, like
            // after Reset View. setStack itself only resets flips, invert and
            // VOI; the rotation used to be undone by a racing readiness retry.
            try { resetViewportCamera(vpCandidate); } catch {}

            try { normalizeCanvasAndContext((vpCandidate?.element as HTMLElement) ?? mountEl); } catch {}
            try { resizeEngineIfNeeded(renderingEngineRef.current); } catch {}
            try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
            try { if (typeof (vpCandidate?.render) === 'function') await vpCandidate.render(); } catch {}
            try { await forceRenderFrames(2, vpCandidate); } catch {}
            return 'set';
          } catch (err) {
            await sleep(120 * (i + 1));
          }
        }

        return 'failed';
      }

      if (vp && imageIds && imageIds.length > 0) {
        try {
          const preferIdx =
            shouldPreserveInitialIndex && typeof lastImageIndexRef.current === 'number'
              ? lastImageIndexRef.current
              : initialIndex;
          const safePreferIdx = Math.max(0, Math.min(preferIdx, (imageIds?.length ?? 1) - 1));

          await robustSetStack(vp, imageIds, safePreferIdx);

          try { resizeEngineIfNeeded(renderingEngineRef.current); } catch {}
          try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
          try { normalizeCanvasAndContext((vp?.element as HTMLElement) ?? mountEl); } catch {}

          const elToCheck = (vp?.element ?? mountEl) as HTMLDivElement | null;
          // Nudge rendering until the stack's image has rendered; the render
          // checks below follow either way. The former fallback attach only
          // called APIs Cornerstone 3D does not have and dispatched a
          // synthetic STACK_NEW_IMAGE event.
          const rendered = await waitForEnabledImage(elToCheck, vp, 3000, 120);

          // setStack resolves once the image is loaded, so an image that has
          // still not rendered points at a canvas that does not match its
          // element (for example one sized while hidden). Fix only that; the
          // former forceRenderCheck resized the whole engine unconditionally,
          // clearing every pane, and reset the viewport options.
          if (!rendered && !isStale()) {
            try { resizeEngineIfNeeded(renderingEngineRef.current); } catch {}
            try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
          }
        } catch (e) {}
      }

      // A newer run took over while this one awaited setStack. It owns the
      // VOI and the stack listener; registering this run's listener as well
      // would leak it, because cleanup only removes the latest handler.
      if (isStale()) return;

      // apply VOI defaults (if provided)
      try {
        const seriesDefault = selectedSeriesId && (voiDefaults[selectedSeriesId] ?? null);
        if (vp && seriesDefault) {
          try { vp.setProperties?.({ voiRange: seriesDefault }); } catch {}
          try { renderingEngineRef.current?.renderViewport?.(VIEWPORT_ID); } catch {}
        }
      } catch (err) {}

      // The cached VOI is only an initialization fallback. Re-applying it every
      // time the stack loops back to image 0 would overwrite a user's current
      // Window/Level adjustment with the first image's original VOI.
      let initialVoiEventPending = !Boolean(voiDefaults[selectedSeriesId]);

      const onStackNewImage = (e: any) => {
        try {
          const eventIndex = e?.detail?.imageIdIndex;
          let viewportIndex: unknown = null;
          try {
            viewportIndex = vp?.getCurrentImageIdIndex?.();
          } catch {}

          const idx = Number.isInteger(eventIndex)
            ? eventIndex
            : Number.isInteger(viewportIndex)
              ? (viewportIndex as number)
              : null;

          if (idx === null) return;

          if (onFrameIndexChange) onFrameIndexChange(idx + 1);

          try {
            if (typeof idx === 'number' && !Number.isNaN(idx)) {
              lastImageIndexRef.current = idx;
            }
          } catch {}

          const shouldInitializeVoi = initialVoiEventPending && idx === initialIndex;
          // Consume the one-time initialization opportunity on the first valid
          // stack event. A later return to image 0 is navigation, not setup.
          initialVoiEventPending = false;

          if (!shouldInitializeVoi) return;

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
        vp?.element?.addEventListener(
          CoreEnums.Events.STACK_NEW_IMAGE,
          onStackNewImage as EventListener
        );
      } catch (e) {}

      if (!isStale()) {
        setViewportInstance(vp ?? null);
        setViewportEl((vp?.element as HTMLDivElement) ?? mountEl);
      }
    })();

    // cleanup
    return () => {
      cancelled = true;
      const tokenAtCleanup = initTokenRef.current;
      const delayMs = 120;

      try {
        cleanupTimerRef.current = window.setTimeout(() => {
          try {
            if (initTokenRef.current !== tokenAtCleanup) return;

            try {
              const handler = stackEventHandlerRef.current;
              if (handler) {
                const elToRemove = (renderingEngineRef.current?.getViewport?.(VIEWPORT_ID)?.element ?? elRef.current);
                try { elToRemove?.removeEventListener(CoreEnums.Events.STACK_NEW_IMAGE, handler as EventListener); } catch (e) {}
              }
            } catch (e) {}

            try {
              // ToolGroup.removeViewports(renderingEngineId, viewportId?). The
              // old call passed `[VIEWPORT_ID]` as the engine ID, which matched
              // nothing and left the primary viewport registered in the group.
              const tg = ToolGroupManager.getToolGroup(TOOL_GROUP);
              const engineId = renderingEngineRef.current?.id ?? RENDERER_ID;
              tg?.removeViewports(engineId, VIEWPORT_ID);
            } catch (e) {}

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
  }, [selectedSeriesId, imageFilesJson, voiDefaults, elRef]);

  return { renderingEngineRef, viewportInstance, viewportEl };
}

export default useRenderingEngine;

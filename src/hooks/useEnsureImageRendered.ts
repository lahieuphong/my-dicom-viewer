// src/hooks/useEnsureImageRendered.ts
'use client';

import { useCallback } from 'react';
import { getEnabledElement, imageLoader } from '@cornerstonejs/core';
import voiLib from '@/lib/cornerstone/voi';
import { VIEWPORT_ID } from '@/constants/viewport';
import { normalizeCanvasAndContext } from '@/lib/viewer/canvasUtils';
import { logCanvasState } from '@/lib/viewer/debugCanvas';
import { ATTEMPTS_POLL } from '@/lib/viewer/constants';
import { wait } from '@/lib/utils/wait';

/**
 * Hook that returns a stable ensureImageRendered function extracted from Viewer.
 */
export function useEnsureImageRendered(options: {
  renderingEngineRef: React.RefObject<any>;
  mergedSeriesMap?: Record<string, { files: string[]; metadata?: any }>;
  voiDefaults?: Record<string, { lower: number; upper: number }>;
}) {
  const { renderingEngineRef, mergedSeriesMap = {}, voiDefaults = {} } = options;

  const isEngineAlive = (eng: any) => {
    try {
      if (!eng) return false;
      if ((eng as any)._destroyed === true) return false;
      if ((eng as any).destroyed === true) return false;
      if ((eng as any).isDestroyed === true) return false;
      return true;
    } catch {
      return false;
    }
  };

  const isVpAlive = (vp: any) => {
    try {
      if (!vp) return false;
      if ((vp as any)._destroyed === true) return false;
      if ((vp as any).destroyed === true) return false;
      if ((vp as any).isDestroyed === true) return false;
      return true;
    } catch {
      return false;
    }
  };

  const ensureImageRendered = useCallback(
    async (
      vpInstanceParam: any,
      vpElParam: HTMLDivElement | null,
      imageIds: string[],
      desiredIndex: number,
      maxRetries = 20,
      retryDelay = 150
    ): Promise<boolean> => {
      if (!Array.isArray(imageIds) || imageIds.length === 0) return false;
      const desiredIndexClamped = Math.max(0, Math.min(desiredIndex ?? 0, imageIds.length - 1));
      const desiredImageId = imageIds[desiredIndexClamped];

      const engine = renderingEngineRef?.current;
      let vpInstance: any = null;
      let vpEl: HTMLDivElement | null = null;
      try {
        vpInstance = engine?.getViewport?.(VIEWPORT_ID) ?? vpInstanceParam ?? null;
        vpEl = (vpInstance?.element as HTMLDivElement) ?? vpElParam ?? null;
      } catch {
        vpInstance = vpInstanceParam ?? null;
        vpEl = vpElParam;
      }

      try {
        logCanvasState?.('START ensureImageRendered', vpEl);
      } catch (e) {}

      const isStale = () => {
        if (renderingEngineRef?.current !== engine) return true;
        if (!isEngineAlive(engine)) return true;
        try {
          const currentVp = engine?.getViewport?.(VIEWPORT_ID) ?? null;
          if (vpInstance && currentVp && currentVp !== vpInstance) return true;
          if (vpInstance && !isVpAlive(vpInstance)) return true;
        } catch {
          return true;
        }
        return false;
      };

      if (isStale()) return false;

      // Preload desired image and neighbors
      try {
        if (imageLoader && typeof (imageLoader as any).loadAndCacheImage === 'function') {
          await (imageLoader as any).loadAndCacheImage(desiredImageId).catch((err: any) => {
          });
        } else {
          const csCore = await import('@cornerstonejs/core').catch(() => null);
          if (csCore && csCore.imageLoader && typeof csCore.imageLoader.loadAndCacheImage === 'function') {
            await csCore.imageLoader.loadAndCacheImage(desiredImageId).catch((err: any) => {
            });
          }
        }
      } catch (e) {
      }

      if (isStale()) return false;

      try {
        const neighbors = 1;
        for (let i = 1; i <= neighbors; i++) {
          const a = desiredIndexClamped + i;
          const b = desiredIndexClamped - i;
          if (a < imageIds.length) imageLoader.loadAndCacheImage(imageIds[a]).catch(() => {});
          if (b >= 0) imageLoader.loadAndCacheImage(imageIds[b]).catch(() => {});
        }
      } catch {}

      // Small layout settle
      try {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        });
      } catch {}

      // Attach stack / image (same as before)...
      try {
        if (vpInstance && isVpAlive(vpInstance) && typeof vpInstance.setStack === 'function') {
          try {
            const currentIndex =
              typeof vpInstance.getCurrentImageIdIndex === 'function'
                ? vpInstance.getCurrentImageIdIndex()
                : -1;

            if (currentIndex === -1) {
              await vpInstance.setStack(imageIds, desiredIndexClamped);
            }
            try {
              logCanvasState?.('AFTER setStack', vpEl);
            } catch (e) {}
          } catch (err) {
          }
        } else if (vpInstance && isVpAlive(vpInstance) && typeof vpInstance.setImageId === 'function') {
          try {
            await vpInstance.setImageId(desiredImageId);
            try {
              logCanvasState?.('AFTER setStack', vpEl);
            } catch (e) {}
          } catch (err) {
          }
        } else {
          const engineAny = engine as any;
          if (engineAny && isEngineAlive(engineAny) && typeof engineAny.setStacks === 'function') {
            try {
              await engineAny.setStacks([{ viewportId: VIEWPORT_ID, imageIds, index: desiredIndexClamped }]);
              try {
                logCanvasState?.('AFTER setStack', vpEl);
              } catch (e) {}
            } catch (err) {
            }
          }
        }

        await wait(30);

        // presentation reset + normalize + render
        try {
          try {
            if (typeof (vpInstance as any).setViewPresentation === 'function') {
              try {
                (vpInstance as any).setViewPresentation({
                  rotation: 0,
                  zoom: 1,
                  flipHorizontal: false,
                  flipVertical: false,
                });
              } catch {}
            } else if (typeof (vpInstance as any).setProperties === 'function') {
              try {
                (vpInstance as any).setProperties({ rotation: 0 });
              } catch {}
            }
          } catch {}

          try { engine?.resize?.(); } catch {}
          try { engine?.renderViewport?.(VIEWPORT_ID); } catch {}
          await wait(60);

          try { if (typeof (vpInstance as any).render === 'function') await (vpInstance as any).render(); } catch {}
          try { engine?.renderViewport?.(VIEWPORT_ID); } catch {}
          try { normalizeCanvasAndContext(vpEl); } catch {}
        } catch (e) {
        }

        try { if (vpInstance && typeof vpInstance.render === 'function') await vpInstance.render(); } catch {}
        try { engine?.renderViewport?.(VIEWPORT_ID); } catch {}
      } catch (e) {
      }

      await wait(30);

      // Apply VOI (kept same)...
      try {
        if (vpInstance && isVpAlive(vpInstance)) {
          const desiredIdStr = String(desiredImageId);
          const cached =
            (voiLib && (voiLib as any).cacheVOI) ? (voiLib as any).cacheVOI.get(desiredIdStr) : null;
          if (cached && typeof cached.lower === 'number' && typeof cached.upper === 'number' && cached.upper > cached.lower) {
            if (isStale()) return false;
            try { vpInstance.setProperties?.({ voiRange: { lower: cached.lower, upper: cached.upper } }); } catch {}
          } else {
            let matchedSeriesUID = '';
            try {
              for (const [uid, data] of Object.entries(mergedSeriesMap || {})) {
                const files = (data as any).files ?? [];
                if (
                  files.some((f: string) => {
                    const n1 = String(f).replace(/^imageId:/, '').split('?')[0];
                    const n2 = String(desiredIdStr).replace(/^imageId:/, '').split('?')[0];
                    return n1 === n2;
                  })
                ) {
                  matchedSeriesUID = uid;
                  break;
                }
              }
            } catch {}

            const seriesDefault =
              matchedSeriesUID && (voiDefaults?.[matchedSeriesUID]) ? voiDefaults[matchedSeriesUID] : null;
            if (seriesDefault) {
              if (isStale()) return false;
              try { vpInstance.setProperties?.({ voiRange: seriesDefault }); } catch {}
            } else {
              if (isStale()) return false;
              try {
                await (voiLib as any).applyVOI(vpInstance, desiredImageId, {
                  persistTo: (v: any) => {
                    try {
                      (voiLib as any).cacheVOI.set(String(desiredImageId), v);
                    } catch {}
                  },
                });
              } catch (e) {
              }
            }
          }

          if (isStale()) return false;
          try {
            if (vpInstance && typeof vpInstance.render === 'function') {
              await vpInstance.render();
              try { logCanvasState?.('AFTER VOI render', vpEl); } catch (e) {}
            }
            try { engine?.renderViewport?.(VIEWPORT_ID); } catch {}
            try { normalizeCanvasAndContext(vpEl); } catch {}
          } catch {}
        }
      } catch (e) {}

      // Attempt renders then poll enabled element for an image
      const safeRender = async () => {
        try {
          if (vpInstance && isVpAlive(vpInstance) && typeof vpInstance.render === 'function') {
            await vpInstance.render();
          }
        } catch (err: any) {
          const msg = String(err || '').toLowerCase();
          if (msg.includes('destroy')) return false;
        }
        try {
          if (engine && isEngineAlive(engine) && typeof engine.renderViewport === 'function') {
            try { engine.renderViewport?.(VIEWPORT_ID); } catch (err: any) {
              const msg = String(err || '').toLowerCase();
              if (msg.includes('destroy')) return false;
            }
          }
        } catch {}
        return true;
      };

      await safeRender();
      if (isStale()) return false;

      const getEnabledSafe = () => {
        try {
          if (!vpEl) return null;
          return getEnabledElement(vpEl as any);
        } catch {
          return null;
        }
      };

      try { normalizeCanvasAndContext(vpEl); } catch {}

      // Use centralized ATTEMPTS_POLL as baseline
      let attempts = 0;
      const maxPoll = Math.max(ATTEMPTS_POLL, Math.max(0, maxRetries));
      while (attempts < maxPoll) {
        if (isStale()) return false;
        try {
          const enabled = getEnabledSafe();
          const hasImage = Boolean((enabled as any)?.image);
          if (hasImage) {
            try { logCanvasState?.(`POLL success attempt=${attempts}`, vpEl); } catch (e) {}
            return true;
          }
        } catch {}
        try { logCanvasState?.(`POLL retry attempt=${attempts}`, vpEl); } catch (e) {}
        await wait(retryDelay);
        attempts += 1;
        try { normalizeCanvasAndContext(vpEl); } catch {}
      }

      try {
        for (let i = 0; i < 4; i++) {
          if (isStale()) return false;
          await safeRender();
          await wait(80);
          try { normalizeCanvasAndContext(vpEl); } catch {}
          const enabled = getEnabledSafe();
          if ((enabled as any)?.image) return true;
        }
      } catch {}

      return false;
    },
    [renderingEngineRef, mergedSeriesMap, voiDefaults]
  );

  return { ensureImageRendered };
}

export default useEnsureImageRendered;

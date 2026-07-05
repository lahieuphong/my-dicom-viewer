// src/hooks/useImageReadiness.ts
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RenderingEngine } from '@cornerstonejs/core';
import { getEnabledElement } from '@cornerstonejs/core';
import { safeGetEnabledElement } from '@/lib/cornerstoneHelpers';

// Reuse centralized helper
import { waitForCornerstoneReady as waitForCornerstoneReadyShared } from '@/lib/viewer/polling';
import { preloadImagesWithTimeout as sharedPreloadImagesWithTimeout } from '@/lib/viewer/preload';

type UseImageReadinessOpts = {
  renderingEngineRef: React.RefObject<RenderingEngine | null>;
  viewportInstance: any | null;
  viewportEl: HTMLDivElement | null;
  selectedSeries?: string | null;
  mergedSeriesMap?: Record<string, { files: string[]; metadata?: any }>;
  ensureImageRendered?: (
    vpInstanceParam: any,
    vpElParam: HTMLDivElement | null,
    imageIds: string[],
    desiredIndex: number,
    maxRetries?: number,
    retryDelay?: number
  ) => Promise<boolean>;
  viewportReady?: boolean;
  // optional: how long to wait in total when doing fallback poll (ms)
  pollTimeoutMs?: number;
};

export function useImageReadiness({
  renderingEngineRef,
  viewportInstance,
  viewportEl,
  selectedSeries,
  mergedSeriesMap = {},
  ensureImageRendered,
  viewportReady = false,
  pollTimeoutMs = 5000,
}: UseImageReadinessOpts) {
  const [imageReady, setImageReady] = useState<boolean>(false);
  const mountedRef = useRef(true);

  // helper: extract imageIds for selected series
  const getImageIdsForSelected = useCallback(() => {
    try {
      return (mergedSeriesMap?.[selectedSeries ?? '']?.files ?? []) as string[];
    } catch {
      return [];
    }
  }, [mergedSeriesMap, selectedSeries]);

  // NOTE: use centralized preload helper (imported) instead of a local duplicate
  const preloadImagesWithTimeout = useCallback(
    async (imageIds: string[], options: { concurrency?: number; perLoadTimeoutMs?: number; limit?: number } = {}) => {
      try {
        // delegate to shared implementation which supports onProgress if needed
        await sharedPreloadImagesWithTimeout(imageIds, {
          concurrency: options.concurrency ?? 3,
          perLoadTimeoutMs: options.perLoadTimeoutMs ?? 8000,
          limit: options.limit ?? Math.min(6, imageIds.length),
        });
      } catch {
        // swallow so readiness flow continues even if preload errors
      }
    },
    []
  );

  // Helper: get enabled element safely (use existing helper where possible)
  const getEnabledSafe = useCallback((el: HTMLDivElement | null) => {
    if (!el) return null;
    try {
      const en = safeGetEnabledElement(el);
      if (en) return en;
    } catch {
      try {
        return getEnabledElement(el);
      } catch {
        // ignore
      }
    }
    return null;
  }, []);

  // Core refresh function: attempt robust ensureImageRendered -> fallback poll -> fallback setStack
  const refresh = useCallback(async (): Promise<boolean> => {
    mountedRef.current = true;
    // reset each refresh
    try { if (mountedRef.current) setImageReady(false); } catch {}

    try {
      const imageIds = getImageIdsForSelected();
      const canUseEnsure =
        typeof ensureImageRendered === 'function' &&
        renderingEngineRef?.current &&
        viewportInstance &&
        viewportEl &&
        Array.isArray(imageIds) &&
        imageIds.length > 0;

      if (canUseEnsure) {
        // wait short time for cornerstone init (use shared helper)
        const csOk = await waitForCornerstoneReadyShared(3500).catch(() => false);
        if (!csOk) {
          // allow fallback path (don't crash) — continue to poll fallback later
          // eslint-disable-next-line no-console
        } else {
          try {
            // warm-up decoder using shared preload helper
            await preloadImagesWithTimeout(imageIds, { concurrency: 3, perLoadTimeoutMs: 8000, limit: 6 });
          } catch (e) {
            // swallow preload errors
          }

          try {
            const ok = await ensureImageRendered(viewportInstance, viewportEl, imageIds, 0, 40, 200);
            if (mountedRef.current && ok) {
              try { setImageReady(true); } catch {}
              return true;
            }
          } catch {
            // fallthrough to fallback
          }
        }
      }

      // fallback 1: quick polling enabled element
      const start = Date.now();
      const interval = 80;
      while (mountedRef.current && Date.now() - start < pollTimeoutMs) {
        try {
          const en = getEnabledSafe(viewportEl);
          if (en && (en as any).image) {
            if (mountedRef.current) {
              try { setImageReady(true); } catch {}
            }
            return true;
          }
        } catch {
          // ignore ephemeral errors
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, interval));
      }

      // final fail-open if viewportReady
      if (viewportReady) {
        if (mountedRef.current) {
          try { setImageReady(true); } catch {}
        }
        return true;
      }

      return false;
    } catch {
      if (mountedRef.current) {
        try { setImageReady(true); } catch {}
      }
      return false;
    }
  }, [
    ensureImageRendered,
    getEnabledSafe,
    getImageIdsForSelected,
    viewportEl,
    viewportInstance,
    renderingEngineRef,
    pollTimeoutMs,
    viewportReady,
  ]);

  // Run refresh when dependencies change
  useEffect(() => {
    mountedRef.current = true;
    (async () => {
      try {
        await refresh();
      } catch {
        // ignore
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  // Short poll watcher to catch race where enabled element gets image shortly after mount
  useEffect(() => {
    if (!viewportEl) return () => {};
    let mounted = true;
    let intervalId: number | null = null;

    const checkOnce = () => {
      try {
        const en = getEnabledSafe(viewportEl);
        if (en && (en as any).image) {
          setImageReady(true);
          return true;
        }
      } catch {
        // ignore
      }
      return false;
    };

    if (checkOnce()) return () => { mounted = false; };

    const start = Date.now();
    intervalId = window.setInterval(() => {
      if (!mounted) return;
      if (Date.now() - start > Math.min(5000, pollTimeoutMs)) {
        if (intervalId != null) {
          clearInterval(intervalId);
          intervalId = null;
        }
        return;
      }
      try {
        if (checkOnce()) {
          if (intervalId != null) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      } catch {}
    }, 200);

    return () => {
      mounted = false;
      if (intervalId != null) clearInterval(intervalId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportEl, selectedSeries]);

  // Listen to common render events (best effort)
  useEffect(() => {
    if (!viewportEl) return () => {};
    const onRendered = () => {
      try {
        setImageReady(true);
      } catch {}
    };

    try { viewportEl.addEventListener('cornerstoneimagerendered', onRendered as EventListener); } catch {}
    try { viewportEl.addEventListener('cornerstone-stack-new-image', onRendered as EventListener); } catch {}

    return () => {
      try { viewportEl.removeEventListener('cornerstoneimagerendered', onRendered as EventListener); } catch {}
      try { viewportEl.removeEventListener('cornerstone-stack-new-image', onRendered as EventListener); } catch {}
    };
  }, [viewportEl]);

  // compute enabled presence quickly for callers
  const enForEnabledHasImage = getEnabledSafe(viewportEl);
  const enabledHasImage = Boolean(
    enForEnabledHasImage &&
      ((enForEnabledHasImage as any).image ||
        (enForEnabledHasImage.viewport &&
          typeof (enForEnabledHasImage.viewport as any).getCurrentImageIdIndex === 'function' &&
          (enForEnabledHasImage.viewport as any).getCurrentImageIdIndex() >= 0))
  );

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  return {
    imageReady,
    refresh,
    enabledHasImage,
  };
}

export default useImageReadiness;
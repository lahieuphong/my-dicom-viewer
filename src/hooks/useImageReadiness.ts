// src/hooks/useImageReadiness.ts
'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RenderingEngine } from '@cornerstonejs/core';
import { getEnabledElement } from '@cornerstonejs/core';
import { safeGetEnabledElement } from '@/lib/cornerstone/helpers';

import { waitForCornerstoneReady as waitForCornerstoneReadyShared } from '@/lib/viewer/polling';

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
    retryDelay?: number,
    isCancelled?: () => boolean
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
  const refreshGenerationRef = useRef(0);

  const selectedImageIds = useMemo(() => {
    try {
      return (mergedSeriesMap?.[selectedSeries ?? '']?.files ?? []) as string[];
    } catch {
      return [];
    }
  }, [mergedSeriesMap, selectedSeries]);
  const selectedImageIdSet = useMemo(
    () => new Set(selectedImageIds),
    [selectedImageIds]
  );

  // helper: extract imageIds for selected series
  const getImageIdsForSelected = useCallback(
    () => selectedImageIds,
    [selectedImageIds]
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

  const hasSelectedStackImage = useCallback(
    (enabledElement: ReturnType<typeof getEnabledSafe>) => {
      if (!enabledElement) return false;

      const imageIds = getImageIdsForSelected();
      if (imageIds.length === 0) return false;

      try {
        const currentImageId =
          enabledElement.viewport?.getCurrentImageId?.() ??
          (enabledElement as any)?.image?.imageId;
        return (
          typeof currentImageId === 'string' &&
          selectedImageIdSet.has(currentImageId)
        );
      } catch {
        return false;
      }
    },
    [getImageIdsForSelected, selectedImageIdSet]
  );

  // Core refresh function: attempt robust ensureImageRendered -> fallback poll -> fallback setStack
  const refresh = useCallback(async (): Promise<boolean> => {
    const generation = ++refreshGenerationRef.current;
    mountedRef.current = true;
    const isCancelled = () =>
      !mountedRef.current || refreshGenerationRef.current !== generation;
    // reset each refresh
    try { if (!isCancelled()) setImageReady(false); } catch {}

    try {
      const imageIds = getImageIdsForSelected();
      const enabledElement = getEnabledSafe(viewportEl);

      // Series changes can briefly leave the previous image on the enabled
      // element. Only short-circuit when the rendered image belongs to the
      // currently selected stack.
      if (hasSelectedStackImage(enabledElement)) {
        if (!isCancelled()) setImageReady(true);
        return true;
      }

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
        if (isCancelled()) return false;
        if (!csOk) {
          // allow fallback path (don't crash) — continue to poll fallback later
        } else {
          try {
            const ok = await ensureImageRendered(
              viewportInstance,
              viewportEl,
              imageIds,
              0,
              40,
              200,
              isCancelled
            );
            if (!isCancelled() && ok && hasSelectedStackImage(getEnabledSafe(viewportEl))) {
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
      while (!isCancelled() && Date.now() - start < pollTimeoutMs) {
        try {
          const en = getEnabledSafe(viewportEl);
          if (hasSelectedStackImage(en)) {
            if (!isCancelled()) {
              try { setImageReady(true); } catch {}
            }
            return true;
          }
        } catch {
          // ignore ephemeral errors
        }
        await new Promise((r) => setTimeout(r, interval));
      }
      if (isCancelled()) return false;

      // final fail-open if viewportReady
      if (
        viewportReady &&
        hasSelectedStackImage(getEnabledSafe(viewportEl))
      ) {
        if (!isCancelled()) {
          try { setImageReady(true); } catch {}
        }
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }, [
    ensureImageRendered,
    getEnabledSafe,
    getImageIdsForSelected,
    hasSelectedStackImage,
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
      refreshGenerationRef.current += 1;
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
        if (hasSelectedStackImage(en)) {
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
  }, [getEnabledSafe, hasSelectedStackImage, pollTimeoutMs, selectedSeries, viewportEl]);

  // Listen to common render events (best effort)
  useEffect(() => {
    if (!viewportEl) return () => {};
    const onRendered = () => {
      try {
        if (hasSelectedStackImage(getEnabledSafe(viewportEl))) {
          setImageReady(true);
        }
      } catch {}
    };

    try { viewportEl.addEventListener('cornerstoneimagerendered', onRendered as EventListener); } catch {}
    try { viewportEl.addEventListener('cornerstone-stack-new-image', onRendered as EventListener); } catch {}

    return () => {
      try { viewportEl.removeEventListener('cornerstoneimagerendered', onRendered as EventListener); } catch {}
      try { viewportEl.removeEventListener('cornerstone-stack-new-image', onRendered as EventListener); } catch {}
    };
  }, [getEnabledSafe, hasSelectedStackImage, viewportEl]);

  // compute enabled presence quickly for callers
  const enForEnabledHasImage = getEnabledSafe(viewportEl);
  const enabledHasImage = hasSelectedStackImage(enForEnabledHasImage);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      refreshGenerationRef.current += 1;
    };
  }, []);

  return {
    imageReady,
    refresh,
    enabledHasImage,
  };
}

export default useImageReadiness;

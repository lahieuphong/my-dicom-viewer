// src/hooks/useViewportState.ts
'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { getEnabledElementSafeLocal } from '@/lib/viewer/dom';
import type { StackViewport } from '@cornerstonejs/core';

type UseViewportStateOpts = {
  viewportInstance?: any | null;
  viewportEl?: HTMLElement | null;
  initialFrame?: number;
};

/**
 * useViewportState
 *
 * - currentFrame: 1-based frame index
 * - setCurrentFrame: accepts 1-based index and attempts to set on viewport (returns Promise<boolean>)
 * - totalFrames: number of frames (if discoverable)
 * - viewportReady: boolean (best-effort)
 * - refreshFromViewport(): re-sync state from viewportInstance / enabled element
 * - saveInitialState(viewport?): capture a small snapshot to allow reset
 * - resetToInitial(viewport?): attempt to restore snapshot (best-effort) -> Promise<void>
 *
 * NOTE: saveInitialState/resetToInitial accept an optional viewport argument.
 * If omitted, the hook will use the internal viewportInstance passed into the hook.
 */
export function useViewportState({
  viewportInstance = null,
  viewportEl = null,
  initialFrame = 1,
}: UseViewportStateOpts = {}) {
  const [currentFrame, setCurrentFrameState] = useState<number>(initialFrame);
  const [totalFrames, setTotalFrames] = useState<number>(0);
  const [viewportReady, setViewportReady] = useState<boolean>(false);

  // snapshot for save/reset
  const initialSnapshotRef = useRef<{ frameIndex: number; viewPresentation?: any } | null>(null);

  const refreshFromViewport = useCallback(() => {
    try {
      // Prefer viewportInstance.getImageIds()
      let ids: string[] | null = null;
      try {
        if (viewportInstance && typeof viewportInstance.getImageIds === 'function') {
          ids = viewportInstance.getImageIds() ?? null;
        }
      } catch {}

      // fallback: enabled element
      if ((!ids || ids.length === 0) && viewportEl) {
        try {
          const en = getEnabledElementSafeLocal(viewportEl as HTMLElement);
          if (en && en.viewport && typeof en.viewport.getImageIds === 'function') {
            ids = en.viewport.getImageIds?.() ?? ids;
          } else if ((en as any)?.image) {
            ids = ids || [];
            if ((en as any).image?.imageId) ids = [String((en as any).image.imageId)];
          }
        } catch {}
      }

      if (Array.isArray(ids) && ids.length > 0) {
        setTotalFrames(ids.length);
        // try get current index (0-based)
        try {
          let idx: number | null = null;
          const idxFn = (viewportInstance as any)?.getCurrentImageIdIndex ?? (viewportInstance as any)?.getImageIdIndex;
          if (typeof idxFn === 'function') {
            const v = idxFn.call(viewportInstance);
            if (typeof v === 'number' && v >= 0) idx = v;
          }
          // fallback: check enabled element
          if (idx === null && viewportEl) {
            try {
              const en2 = getEnabledElementSafeLocal(viewportEl as HTMLElement);
              if (en2 && en2.viewport && typeof en2.viewport.getCurrentImageIdIndex === 'function') {
                const v2 = en2.viewport.getCurrentImageIdIndex();
                if (typeof v2 === 'number' && v2 >= 0) idx = v2;
              }
            } catch {}
          }
          if (idx !== null && typeof idx === 'number') {
            setCurrentFrameState(idx + 1);
          } else {
            setCurrentFrameState((prev) => (prev >= 1 && prev <= ids!.length ? prev : 1));
          }
        } catch {
          setCurrentFrameState((prev) => (prev >= 1 && prev <= ids!.length ? prev : 1));
        }
        setViewportReady(true);
      } else {
        setTotalFrames(0);
        setViewportReady(false);
      }
    } catch {
      // swallow
    }
  }, [viewportInstance, viewportEl]);

  // initialise / resync when deps change
  useEffect(() => {
    refreshFromViewport();
    let t: number | null = null;
    try { t = window.setTimeout(() => refreshFromViewport(), 220) as unknown as number; } catch {}
    return () => { try { if (t != null) window.clearTimeout(t); } catch {} };
  }, [refreshFromViewport]);

  // listen to stack-new-image events and sync currentFrame
  useEffect(() => {
    if (!viewportEl) return () => {};
    const handler = (e: any) => {
      try {
        const idx = typeof e?.detail?.imageIdIndex === 'number' ? e.detail.imageIdIndex : undefined;
        if (typeof idx === 'number') {
          setCurrentFrameState(idx + 1);
        } else {
          try {
            const fn = (viewportInstance as any)?.getCurrentImageIdIndex ?? (viewportInstance as any)?.getImageIdIndex;
            if (typeof fn === 'function') {
              const v = fn.call(viewportInstance);
              if (typeof v === 'number' && v >= 0) setCurrentFrameState(v + 1);
            }
          } catch {}
        }
      } catch {}
    };

    try {
      viewportEl.addEventListener('cornerstone-stack-new-image', handler as EventListener);
    } catch {}
    return () => {
      try { viewportEl.removeEventListener('cornerstone-stack-new-image', handler as EventListener); } catch {}
    };
  }, [viewportEl, viewportInstance]);

  // Set current frame safely (accepts 1-based index)
  const setCurrentFrame = useCallback(
    async (frameOneBased: number): Promise<boolean> => {
      try {
        const idx = Math.max(0, Math.floor(Number(frameOneBased) || 0) - 1);
        if (viewportInstance && typeof viewportInstance.setImageIndex === 'function') {
          try {
            console.trace('🔥 FRAME SET HERE');
            viewportInstance.setImageIndex(idx);
            setCurrentFrameState(idx + 1);
            return true;
          } catch {}
        }
        if (viewportInstance && typeof viewportInstance.setStack === 'function') {
          try {
            const ids = viewportInstance.getImageIds?.() ?? null;
            if (Array.isArray(ids) && ids.length) {
              console.trace('🔥 FRAME SET HERE');
              await viewportInstance.setStack(ids, Math.max(0, Math.min(idx, ids.length - 1)));
              setCurrentFrameState(Math.max(0, Math.min(idx, ids.length - 1)) + 1);
              return true;
            }
          } catch {}
        }
      } catch {}
      return false;
    },
    [viewportInstance]
  );

  // ----- snapshot helpers (compatible with existing Viewer usage) -----
  // saveInitialState optionally accepts viewport param (defaults to internal viewportInstance)
  const saveInitialState = useCallback((viewport?: StackViewport | null): boolean => {
    try {
      const vp = (viewport ?? viewportInstance) as any;
      let frameIdx = Math.max(0, (Number(currentFrame) || 1) - 1);
      try {
        const idxFn = vp?.getCurrentImageIdIndex ?? vp?.getImageIdIndex;
        if (typeof idxFn === 'function') {
          const v = idxFn.call(vp);
          if (typeof v === 'number' && v >= 0) frameIdx = v;
        }
      } catch {}
      let viewPresentation = null;
      try {
        if (vp && typeof vp.getViewPresentation === 'function') {
          viewPresentation = vp.getViewPresentation();
        }
      } catch {}
      initialSnapshotRef.current = { frameIndex: frameIdx, viewPresentation: viewPresentation ?? undefined };
      return true;
    } catch {
      return false;
    }
  }, [viewportInstance, currentFrame]);

  /**
   * resetToInitial(viewport?)
   * - Accepts optional viewport (if not provided, uses internal viewportInstance).
   * - Returns Promise<void> to match useResetViewer expectation.
   */
  const resetToInitial = useCallback(async (viewport?: StackViewport | null): Promise<void> => {
    try {
      const snap = initialSnapshotRef.current;
      if (!snap) return;
      const vp = (viewport ?? viewportInstance) as any;
      const idx = Math.max(0, Math.floor(Number(snap.frameIndex) || 0));
      try {
        if (vp && typeof vp.setImageIndex === 'function') {
          console.trace('🔥 FRAME SET HERE');
          vp.setImageIndex(idx);
        } else if (vp && typeof vp.setStack === 'function') {
          const ids = vp.getImageIds?.() ?? null;
          if (Array.isArray(ids) && ids.length) {
            console.trace('🔥 FRAME SET HERE');
            await vp.setStack(ids, Math.max(0, Math.min(idx, ids.length - 1)));
          }
        }
      } catch {}
      try {
        if (snap.viewPresentation && typeof vp?.setViewPresentation === 'function') {
          vp.setViewPresentation(snap.viewPresentation);
        }
      } catch {}
      // best-effort sync state after reset
      refreshFromViewport();
    } catch {
      // ignore
    }
  }, [viewportInstance, refreshFromViewport]);

  return {
    currentFrame,
    setCurrentFrame,
    totalFrames,
    viewportReady,
    refreshFromViewport,
    saveInitialState,
    resetToInitial,
  } as const;
}

export default useViewportState;
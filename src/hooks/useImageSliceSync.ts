'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Enums, eventTarget } from '@cornerstonejs/core';

import {
  refreshImageSliceSync,
  setImageSliceSyncEnabled,
} from '@/lib/cornerstone/imageSliceSync';

export type UseImageSliceSyncOptions = {
  /** Reconcile after the active stack changes. */
  stackKey?: string | null;
  /** SR and other non-image modes cannot participate in slice sync. */
  disabled?: boolean;
};

export type UseImageSliceSyncResult = {
  isEnabled: boolean;
  canToggle: boolean;
  viewportCount: number;
  toggle: () => boolean;
  disable: () => void;
};

/** Owns the UI state and viewport lifecycle of OHIF-style Image Slice Sync. */
export function useImageSliceSync({
  stackKey = null,
  disabled = false,
}: UseImageSliceSyncOptions = {}): UseImageSliceSyncResult {
  const [isEnabled, setIsEnabled] = useState(false);
  const [canSynchronize, setCanSynchronize] = useState(false);
  const [viewportCount, setViewportCount] = useState(0);
  const isEnabledRef = useRef(false);
  const refreshFrameRef = useRef<number | null>(null);

  const commitEnabled = useCallback((enabled: boolean) => {
    isEnabledRef.current = enabled;
    setIsEnabled((current) => (current === enabled ? current : enabled));
  }, []);

  const refresh = useCallback(() => {
    try {
      const snapshot = refreshImageSliceSync();
      commitEnabled(snapshot.enabled);
      setCanSynchronize(snapshot.canSynchronize);
      setViewportCount((current) =>
        current === snapshot.viewportCount ? current : snapshot.viewportCount
      );
    } catch {
      setCanSynchronize(false);
      setViewportCount(0);
    }
  }, [commitEnabled]);

  const scheduleRefresh = useCallback(() => {
    if (refreshFrameRef.current !== null) return;
    refreshFrameRef.current = window.requestAnimationFrame(() => {
      refreshFrameRef.current = null;
      refresh();
    });
  }, [refresh]);

  const applyEnabled = useCallback(
    (enabled: boolean): boolean => {
      if (disabled && enabled) return false;

      try {
        const snapshot = setImageSliceSyncEnabled(enabled);
        commitEnabled(snapshot.enabled);
        setCanSynchronize(snapshot.canSynchronize);
        setViewportCount(snapshot.viewportCount);
        return snapshot.enabled;
      } catch {
        try {
          setImageSliceSyncEnabled(false);
        } catch {}
        commitEnabled(false);
        setCanSynchronize(false);
        return false;
      }
    },
    [commitEnabled, disabled]
  );

  const toggle = useCallback(
    () => applyEnabled(!isEnabledRef.current),
    [applyEnabled]
  );

  const disable = useCallback(() => {
    applyEnabled(false);
  }, [applyEnabled]);

  useEffect(() => {
    const handleViewportLifecycle = () => scheduleRefresh();

    eventTarget.addEventListener(
      Enums.Events.ELEMENT_ENABLED,
      handleViewportLifecycle
    );
    eventTarget.addEventListener(
      Enums.Events.ELEMENT_DISABLED,
      handleViewportLifecycle
    );
    document.addEventListener(
      Enums.Events.VIEWPORT_NEW_IMAGE_SET,
      handleViewportLifecycle,
      true
    );
    scheduleRefresh();

    return () => {
      eventTarget.removeEventListener(
        Enums.Events.ELEMENT_ENABLED,
        handleViewportLifecycle
      );
      eventTarget.removeEventListener(
        Enums.Events.ELEMENT_DISABLED,
        handleViewportLifecycle
      );
      document.removeEventListener(
        Enums.Events.VIEWPORT_NEW_IMAGE_SET,
        handleViewportLifecycle,
        true
      );
      if (refreshFrameRef.current !== null) {
        window.cancelAnimationFrame(refreshFrameRef.current);
        refreshFrameRef.current = null;
      }
      try {
        setImageSliceSyncEnabled(false);
      } catch {}
    };
  }, [scheduleRefresh]);

  useEffect(() => {
    scheduleRefresh();
  }, [scheduleRefresh, stackKey]);

  useEffect(() => {
    if (disabled && isEnabledRef.current) disable();
  }, [disable, disabled]);

  return {
    isEnabled,
    canToggle: !disabled && canSynchronize,
    viewportCount,
    toggle,
    disable,
  };
}

export default useImageSliceSync;

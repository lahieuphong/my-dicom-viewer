'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Enums, type StackViewport } from '@cornerstonejs/core';

export type UseInvertOptions = {
  viewportInstance: StackViewport | null;
  /** Identifies the attached stack. A new stack must not inherit stale UI state. */
  stackKey?: string | null;
  /** Should only be true once the current stack has a renderable image. */
  enabled?: boolean;
};

export type UseInvertResult = {
  isInverted: boolean;
  canInvert: boolean;
  /** Toggles the live viewport value and returns the value actually applied. */
  toggleInvert: () => boolean;
  /** Re-reads the live viewport value and returns the synchronized value. */
  syncInvertFromViewport: () => boolean;
};

/**
 * Owns the UI-facing state for Cornerstone's viewport invert property.
 *
 * Invert is a viewport presentation toggle, not an active mouse tool. Reading
 * the live property for every toggle also keeps rapid consecutive clicks from
 * using a stale React state value.
 */
export function useInvert({
  viewportInstance,
  stackKey = null,
  enabled = true,
}: UseInvertOptions): UseInvertResult {
  const [isInverted, setIsInverted] = useState(false);
  const isInvertedRef = useRef(false);

  const commitInvertState = useCallback((nextValue: boolean) => {
    isInvertedRef.current = nextValue;
    setIsInverted((currentValue) =>
      currentValue === nextValue ? currentValue : nextValue
    );
  }, []);

  const canInvert = Boolean(
    enabled &&
      viewportInstance &&
      typeof viewportInstance.getProperties === 'function' &&
      typeof viewportInstance.setProperties === 'function' &&
      typeof viewportInstance.render === 'function'
  );

  const syncInvertFromViewport = useCallback((): boolean => {
    if (!canInvert || !viewportInstance) {
      commitInvertState(false);
      return false;
    }

    try {
      const nextValue = Boolean(viewportInstance.getProperties()?.invert);
      commitInvertState(nextValue);
      return nextValue;
    } catch {
      // A viewport can disappear while a new stack is being attached.
      commitInvertState(false);
      return false;
    }
  }, [canInvert, commitInvertState, viewportInstance]);

  const toggleInvert = useCallback((): boolean => {
    if (!canInvert || !viewportInstance) return isInvertedRef.current;

    try {
      const currentValue = Boolean(viewportInstance.getProperties()?.invert);
      const requestedValue = !currentValue;

      viewportInstance.setProperties({ invert: requestedValue });
      viewportInstance.render();

      // Read back from Cornerstone so UI state reflects the value that the
      // active CPU/GPU rendering path actually accepted.
      const appliedValue = Boolean(viewportInstance.getProperties()?.invert);
      commitInvertState(appliedValue);
      return appliedValue;
    } catch {
      return syncInvertFromViewport();
    }
  }, [canInvert, commitInvertState, syncInvertFromViewport, viewportInstance]);

  useEffect(() => {
    // Loading a different stack is asynchronous. Clear the previous stack's
    // visual state now; the enabled transition below synchronizes the new one
    // only after its image is ready.
    commitInvertState(false);
  }, [commitInvertState, stackKey]);

  useEffect(() => {
    syncInvertFromViewport();
  }, [enabled, syncInvertFromViewport, viewportInstance]);

  useEffect(() => {
    const element = viewportInstance?.element;
    if (!element) return;

    // setStack resets presentation properties before the new image is ready.
    // This low-frequency event keeps the UI aligned even if readiness never
    // exposes a separate false -> true transition for a very fast stack swap.
    const handleNewImageSet = () => {
      if (enabled) syncInvertFromViewport();
    };

    element.addEventListener(
      Enums.Events.VIEWPORT_NEW_IMAGE_SET,
      handleNewImageSet
    );
    return () => {
      element.removeEventListener(
        Enums.Events.VIEWPORT_NEW_IMAGE_SET,
        handleNewImageSet
      );
    };
  }, [enabled, syncInvertFromViewport, viewportInstance]);

  return {
    isInverted,
    canInvert,
    toggleInvert,
    syncInvertFromViewport,
  };
}

export default useInvert;

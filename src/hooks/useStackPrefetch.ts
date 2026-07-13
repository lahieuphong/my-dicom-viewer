'use client';

import { useEffect } from 'react';
import { Enums as CoreEnums, getEnabledElement } from '@cornerstonejs/core';
import { utilities } from '@cornerstonejs/tools';

/**
 * Keeps nearby stack images warm using Cornerstone's direction-aware prefetcher.
 * This is the same prefetch path used by OHIF for stack viewports.
 */
export function useStackPrefetch(element: HTMLDivElement | null) {
  useEffect(() => {
    if (!element) return;

    const stackContextPrefetch = utilities.stackContextPrefetch;
    if (!stackContextPrefetch) return;

    let activationFrame: number | null = null;

    const enablePrefetch = () => {
      try {
        const enabledElement = getEnabledElement(element);
        const imageIds = enabledElement?.viewport?.getImageIds?.();

        if (!Array.isArray(imageIds) || imageIds.length <= 1) {
          stackContextPrefetch.disable(element);
          return;
        }

        stackContextPrefetch.enable(element);
      } catch {
        // The viewport may still be between enableElement and setStack.
      }
    };

    const handleNewImageSet = (event: Event) => {
      const eventElement = (event as CustomEvent<{ element?: HTMLDivElement }>).detail?.element;
      if (eventElement && eventElement !== element) return;
      enablePrefetch();
    };

    element.addEventListener(
      CoreEnums.Events.VIEWPORT_NEW_IMAGE_SET,
      handleNewImageSet as EventListener
    );

    // The first stack may already be attached before this hook receives the element.
    activationFrame = window.requestAnimationFrame(enablePrefetch);

    return () => {
      if (activationFrame != null) {
        window.cancelAnimationFrame(activationFrame);
      }
      element.removeEventListener(
        CoreEnums.Events.VIEWPORT_NEW_IMAGE_SET,
        handleNewImageSet as EventListener
      );
      try {
        stackContextPrefetch.disable(element);
      } catch {}
    };
  }, [element]);
}

export default useStackPrefetch;

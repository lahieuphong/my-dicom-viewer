'use client';

import { useEffect } from 'react';
import { Enums as CoreEnums } from '@cornerstonejs/core';

import { ensureStackScrollWheelActive } from '@/lib/cornerstone/stackScroll';

/**
 * Keeps OHIF-style wheel navigation bound across viewport and stack changes.
 * Actual scrolling stays entirely inside Cornerstone's StackScrollTool.
 */
export function useStackScrollWheel(
  element: HTMLDivElement | null,
  stackKey?: string | null
) {
  useEffect(() => {
    if (!element) return;

    let activationFrame: number | null = null;

    const activateWheelNavigation = () => {
      ensureStackScrollWheelActive();
    };

    const handleNewImageSet = (event: Event) => {
      const eventElement = (event as CustomEvent<{ element?: HTMLDivElement }>).detail?.element;
      if (eventElement && eventElement !== element) return;
      activateWheelNavigation();
    };

    element.addEventListener(
      CoreEnums.Events.VIEWPORT_NEW_IMAGE_SET,
      handleNewImageSet as EventListener
    );

    // The viewport is added to its ToolGroup immediately before this hook sees
    // the element. One RAF keeps activation ordered after that attachment.
    activationFrame = window.requestAnimationFrame(activateWheelNavigation);

    return () => {
      if (activationFrame != null) {
        window.cancelAnimationFrame(activationFrame);
      }
      element.removeEventListener(
        CoreEnums.Events.VIEWPORT_NEW_IMAGE_SET,
        handleNewImageSet as EventListener
      );
    };
  }, [element, stackKey]);
}

export default useStackScrollWheel;

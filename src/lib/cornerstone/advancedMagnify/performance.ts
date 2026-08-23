'use client';

import { AdvancedMagnifyTool } from '@cornerstonejs/tools';

const FRAME_SCHEDULER_FLAG = Symbol.for(
  'my-dicom-viewer.advanced-magnify-frame-scheduler'
);

type MagnifyViewportLike = {
  update: () => void;
  dispose: () => void;
};

type MagnifyViewportManagerLike = {
  createViewport: (...args: unknown[]) => MagnifyViewportLike;
  [FRAME_SCHEDULER_FLAG]?: boolean;
};

type AdvancedMagnifyToolLike = {
  magnifyViewportManager: MagnifyViewportManagerLike;
};

/**
 * Cornerstone updates every magnify viewport from every annotation render.
 * Pointer devices can emit several drag events before the browser paints the
 * next frame, especially when multiple loupes exist. Coalescing those calls
 * keeps camera synchronisation native while avoiding duplicate work that can
 * never become visible to the user.
 */
function scheduleViewportUpdatesByFrame(
  magnifyViewport: MagnifyViewportLike
): MagnifyViewportLike {
  if (
    typeof window === 'undefined' ||
    typeof window.requestAnimationFrame !== 'function'
  ) {
    return magnifyViewport;
  }

  const nativeUpdate = magnifyViewport.update.bind(magnifyViewport);
  const nativeDispose = magnifyViewport.dispose.bind(magnifyViewport);
  let animationFrame: number | null = null;
  let disposed = false;

  magnifyViewport.update = () => {
    if (disposed || animationFrame !== null) return;

    animationFrame = window.requestAnimationFrame(() => {
      animationFrame = null;
      if (!disposed) nativeUpdate();
    });
  };

  magnifyViewport.dispose = () => {
    disposed = true;
    if (animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = null;
    }
    nativeDispose();
  };

  return magnifyViewport;
}

export function enableAdvancedMagnifyFrameScheduling(
  toolInstance: AdvancedMagnifyTool | undefined
): void {
  const manager = (
    toolInstance as unknown as AdvancedMagnifyToolLike | undefined
  )?.magnifyViewportManager;
  if (!manager || manager[FRAME_SCHEDULER_FLAG]) return;

  const nativeCreateViewport = manager.createViewport.bind(manager);
  manager.createViewport = (...args: unknown[]) =>
    scheduleViewportUpdatesByFrame(nativeCreateViewport(...args));
  manager[FRAME_SCHEDULER_FLAG] = true;
}

// src/hooks/useRenderingEngine.ts
'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RenderingEngine, StackViewport } from '@cornerstonejs/core';
import { Enums as CoreEnums } from '@cornerstonejs/core';
import { initCornerstone } from '@/lib/cornerstone';
import { getRenderingEngine, RENDERER_ID } from '@/lib/cornerstone/renderer';
import { VIEWPORT_ID } from '@/constants/viewport';
import { ATTEMPTS_ENGINE } from '@/lib/viewer/constants';
import { areImageStacksEqual } from '@/lib/cornerstone/helpers';
import { resizeEngineIfNeeded } from '@/lib/viewer/fitViewport';
import { renderViewportUntilReady } from '@/lib/viewer/renderUntilReady';
import {
  mountStackViewport,
  unmountStackViewport,
} from '@/lib/viewer/stackViewportLifecycle';
import { resetViewportCamera } from '@/lib/viewer/viewportActions';

const sleep = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

type MountedViewport = {
  engine: RenderingEngine;
  viewport: StackViewport;
  element: HTMLDivElement;
};

/** The stack the viewport shows, published once its first image is drawn. */
export type AttachedStack = {
  seriesId: string;
  imageIds: readonly string[];
};

/**
 * Sets `imageIds` on the viewport at `index`. Returns 'kept' when the viewport
 * already shows that stack and must keep its image and view, 'set' when the
 * stack was set, and 'failed' otherwise.
 */
async function setStackAt(
  viewport: StackViewport,
  imageIds: string[],
  index: number,
  keepCurrentImage: boolean,
  isCancelled: () => boolean
): Promise<'kept' | 'set' | 'failed'> {
  try {
    const currentIds = viewport.getImageIds?.();
    if (
      Array.isArray(currentIds) &&
      currentIds.length > 0 &&
      areImageStacksEqual(currentIds, imageIds)
    ) {
      // A re-run for the series already shown (a remount on the same element,
      // or new series data with the same images) must not set the same stack
      // again: that would move the user back to the remembered index and
      // reset the view.
      if (keepCurrentImage) return 'kept';
      if (viewport.getCurrentImageIdIndex?.() === index) return 'kept';
    }
  } catch {}

  for (let attempt = 0; attempt < ATTEMPTS_ENGINE && !isCancelled(); attempt++) {
    try {
      // setStack fits the camera to the canvas it finds, so the canvas must
      // match its element first.
      try { resizeEngineIfNeeded(viewport.getRenderingEngine?.()); } catch {}
      await viewport.setStack(imageIds, index);
      // A newly selected series opens in the default orientation, like after
      // Reset View. setStack itself only resets flips, invert and VOI.
      try { resetViewportCamera(viewport); } catch {}
      return 'set';
    } catch {
      await sleep(120 * (attempt + 1));
    }
  }
  return 'failed';
}

/**
 * Owns the primary pane's stack viewport. One effect enables the viewport on
 * the pane's element for as long as that element is mounted; another sets the
 * selected series' stack on it. A series switch therefore reuses the viewport
 * instead of tearing it down, and unmounting disables it right away, the way
 * every secondary pane (useSecondaryStackViewport) does.
 */
export function useRenderingEngine({
  elRef,
  selectedSeriesId,
  mergedSeriesMap,
  onFrameIndexChange,
  getInitialImageIndex,
}: {
  elRef: React.RefObject<HTMLDivElement | null>;
  selectedSeriesId: string;
  mergedSeriesMap: Record<string, { files: string[]; metadata: any }>;
  onFrameIndexChange?: (index: number) => void;
  /** The image a newly selected series opens at; the first one by default. */
  getInitialImageIndex?: (seriesId: string) => number | null | undefined;
}) {
  const renderingEngineRef = useRef<RenderingEngine | null>(null);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState<MountedViewport | null>(null);
  // Consumers get the viewport once it shows its first stack; it stays
  // published across series switches.
  const [published, setPublished] = useState<MountedViewport | null>(null);
  const [attachedStack, setAttachedStack] = useState<AttachedStack | null>(null);

  const lastImageIndexRef = useRef<number | null>(null);
  const previousSeriesIdRef = useRef<string | null>(null);
  const onFrameIndexChangeRef = useRef(onFrameIndexChange);
  const getInitialImageIndexRef = useRef(getInitialImageIndex);
  const observedElementRef = useRef<HTMLDivElement | null>(null);

  // The pane's element mounts and unmounts with the workspace, which only
  // happens when this component renders; mirror it into state so the viewport
  // follows it.
  useLayoutEffect(() => {
    onFrameIndexChangeRef.current = onFrameIndexChange;
    getInitialImageIndexRef.current = getInitialImageIndex;
    const current = elRef.current;
    if (current !== observedElementRef.current) {
      observedElementRef.current = current;
      setElement(current);
    }
  });

  useEffect(() => {
    if (!element) return;

    let cancelled = false;
    let mountedEngine: RenderingEngine | null = null;

    void (async () => {
      try {
        await initCornerstone();
      } catch {}
      if (cancelled) return;

      try {
        const engine = getRenderingEngine(RENDERER_ID);
        renderingEngineRef.current = engine;
        // Set first, so cleanup also undoes a mount that threw halfway.
        mountedEngine = engine;
        const viewport = mountStackViewport(engine, VIEWPORT_ID, element);
        setMounted({ engine, viewport, element });
      } catch {}
    })();

    return () => {
      cancelled = true;
      if (mountedEngine) {
        unmountStackViewport(mountedEngine, VIEWPORT_ID, element);
      }
      setMounted(null);
      setPublished(null);
      setAttachedStack(null);
    };
  }, [element]);

  const imageFilesJson = useMemo(() => {
    try {
      return JSON.stringify(mergedSeriesMap?.[selectedSeriesId]?.files ?? []);
    } catch {
      return '[]';
    }
  }, [selectedSeriesId, mergedSeriesMap]);

  useEffect(() => {
    if (!mounted || !selectedSeriesId) return;

    const keepCurrentImage = previousSeriesIdRef.current === selectedSeriesId;
    if (!keepCurrentImage) lastImageIndexRef.current = null;
    previousSeriesIdRef.current = selectedSeriesId;

    const imageIds: string[] = JSON.parse(imageFilesJson);
    const { viewport, element: viewportElement } = mounted;
    let cancelled = false;
    const isCancelled = () => cancelled;
    let removeStackListener = () => {};

    void (async () => {
      if (imageIds.length === 0) {
        setPublished(mounted);
        return;
      }

      const rememberedIndex = keepCurrentImage ? lastImageIndexRef.current : null;
      let requestedIndex = rememberedIndex;
      if (requestedIndex === null) {
        try {
          requestedIndex = getInitialImageIndexRef.current?.(selectedSeriesId) ?? null;
        } catch {}
      }
      const index = Math.max(
        0,
        Math.min(
          Number.isInteger(requestedIndex) ? Number(requestedIndex) : 0,
          imageIds.length - 1
        )
      );

      const outcome = await setStackAt(
        viewport,
        imageIds,
        index,
        keepCurrentImage,
        isCancelled
      );
      if (cancelled) return;

      // Render until Cornerstone reports the draw, the way every secondary
      // pane does: callers change the camera after setStack.
      if (outcome !== 'failed') {
        await renderViewportUntilReady({
          viewport,
          viewportId: VIEWPORT_ID,
          element: viewportElement,
          expectedImageIds: new Set(imageIds),
          isCancelled,
        });
        if (cancelled) return;
      }

      // Tracks the shown image for the frame UI and for keeping the index on
      // a re-run for the same series.
      const onStackNewImage = (event: Event) => {
        const eventIndex = (event as CustomEvent<{ imageIdIndex?: number }>)
          .detail?.imageIdIndex;
        let idx: number | null = Number.isInteger(eventIndex)
          ? Number(eventIndex)
          : null;
        if (idx === null) {
          try {
            const viewportIndex = viewport.getCurrentImageIdIndex?.();
            if (Number.isInteger(viewportIndex)) idx = viewportIndex;
          } catch {}
        }
        if (idx === null) return;

        try { onFrameIndexChangeRef.current?.(idx + 1); } catch {}
        lastImageIndexRef.current = idx;
      };
      viewportElement.addEventListener(
        CoreEnums.Events.STACK_NEW_IMAGE,
        onStackNewImage
      );
      removeStackListener = () =>
        viewportElement.removeEventListener(
          CoreEnums.Events.STACK_NEW_IMAGE,
          onStackNewImage
        );

      setPublished(mounted);
      if (outcome !== 'failed') {
        setAttachedStack({ seriesId: selectedSeriesId, imageIds });
      }
    })();

    return () => {
      cancelled = true;
      removeStackListener();
    };
  }, [mounted, selectedSeriesId, imageFilesJson]);

  return {
    renderingEngineRef,
    viewportInstance: published?.viewport ?? null,
    viewportEl: published?.element ?? null,
    attachedStack,
  };
}

export default useRenderingEngine;

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Enums as CoreEnums,
  type RenderingEngine,
  StackViewport,
  utilities as csCoreUtilities,
} from '@cornerstonejs/core';

import { initCornerstone } from '@/lib/cornerstone';
import {
  getRenderingEngine,
  RENDERER_ID,
} from '@/lib/cornerstone/renderer';
import { useStackScrollWheel } from '@/hooks/useStackScrollWheel';
import { renderViewportUntilReady } from '@/lib/viewer/renderUntilReady';
import {
  mountStackViewport,
  unmountStackViewport,
} from '@/lib/viewer/stackViewportLifecycle';

type UseSecondaryStackViewportOptions = {
  viewportId: string;
  imageIds: readonly string[];
  stackKey: string;
};

// ContextPoolRenderingEngine renders every viewport through a shared pool of
// WebGL contexts. Keep only the bounded final-render phase ordered; DICOM
// loading must remain independent so one slow request cannot block every pane.
let secondaryViewportRenderQueue: Promise<void> = Promise.resolve();

function enqueueSecondaryViewportRender(task: () => Promise<boolean>) {
  const queuedTask = secondaryViewportRenderQueue
    .catch(() => {})
    .then(async () => {
      await task();
    });
  secondaryViewportRenderQueue = queuedTask.catch(() => {});
  return queuedTask;
}

/**
 * Owns one additional stack viewport without touching the legacy primary
 * viewport. All panes share the same RenderingEngine and ToolGroup, which is
 * what lets Cornerstone tools and Image Slice Sync work across the grid.
 */
export function useSecondaryStackViewport({
  viewportId,
  imageIds,
  stackKey,
}: UseSecondaryStackViewportOptions) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<StackViewport | null>(null);
  const [viewportEl, setViewportEl] = useState<HTMLDivElement | null>(null);
  const [currentFrame, setCurrentFrame] = useState(1);
  const [loading, setLoading] = useState(true);
  const [imageAvailable, setImageAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stackLoadGenerationRef = useRef(0);
  const stackLoadQueueRef = useRef<Promise<void>>(Promise.resolve());
  const imageIdsSignature = useMemo(() => imageIds.join('\u001f'), [imageIds]);

  useEffect(() => {
    let cancelled = false;
    let mounted: { engine: RenderingEngine; element: HTMLDivElement } | null =
      null;

    void (async () => {
      try {
        await initCornerstone();
        if (cancelled) return;

        const element = elementRef.current;
        if (!element) return;

        const engine = getRenderingEngine(RENDERER_ID);
        // Set first, so cleanup also undoes a mount that threw halfway.
        mounted = { engine, element };
        const stackViewport = mountStackViewport(engine, viewportId, element);

        setViewport(stackViewport);
        setViewportEl(element);
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Không thể khởi tạo viewport phụ.'
          );
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (mounted) {
        unmountStackViewport(mounted.engine, viewportId, mounted.element);
      }
      setViewport(null);
      setViewportEl(null);
    };
  }, [viewportId]);

  useEffect(() => {
    if (!viewport) return;
    const normalizedImageIds = Array.from(imageIds);
    const loadGeneration = ++stackLoadGenerationRef.current;

    let cancelled = false;
    setLoading(true);
    setImageAvailable(false);
    setError(null);
    setCurrentFrame(1);

    const loadStack = async () => {
      try {
        if (
          cancelled ||
          loadGeneration !== stackLoadGenerationRef.current
        ) {
          return;
        }
        if (normalizedImageIds.length === 0) {
          throw new Error('Series này không có ảnh DICOM để hiển thị.');
        }

        await viewport.setStack(normalizedImageIds, 0);
        if (
          cancelled ||
          loadGeneration !== stackLoadGenerationRef.current
        ) {
          return;
        }

        try {
          viewport.resetCamera({
            resetPan: true,
            resetZoom: true,
            resetToCenter: true,
          });
        } catch {}
        const element = viewport.element as HTMLDivElement;
        let rendered = false;
        await enqueueSecondaryViewportRender(async () => {
          rendered = await renderViewportUntilReady({
            viewport,
            viewportId,
            element,
            expectedImageIds: new Set(normalizedImageIds),
            isCancelled: () =>
              cancelled ||
              loadGeneration !== stackLoadGenerationRef.current,
          });
          return rendered;
        });

        if (
          cancelled ||
          loadGeneration !== stackLoadGenerationRef.current
        ) {
          return;
        }
        if (!rendered) {
          throw new Error(
            'Ảnh chưa render hoàn tất. Vui lòng thử lại bố cục.'
          );
        }

        setCurrentFrame((viewport.getCurrentImageIdIndex?.() ?? 0) + 1);
        setImageAvailable(true);
        setLoading(false);
      } catch (cause) {
        if (
          !cancelled &&
          loadGeneration === stackLoadGenerationRef.current
        ) {
          setError(
            cause instanceof Error
              ? cause.message
              : 'Không thể tải stack DICOM.'
          );
          setLoading(false);
        }
      }
    };

    const queuedLoad = stackLoadQueueRef.current
      .catch(() => {})
      .then(loadStack);
    stackLoadQueueRef.current = queuedLoad.catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [imageIdsSignature, stackKey, viewport, viewportId]);

  useEffect(() => {
    if (!viewportEl) return;

    const handleNewImage = (event: Event) => {
      const imageIdIndex = (
        event as CustomEvent<{ imageIdIndex?: number }>
      ).detail?.imageIdIndex;
      const nextIndex = Number.isInteger(imageIdIndex)
        ? Number(imageIdIndex)
        : viewport?.getCurrentImageIdIndex?.();
      if (Number.isInteger(nextIndex)) setCurrentFrame(Number(nextIndex) + 1);
    };

    viewportEl.addEventListener(
      CoreEnums.Events.STACK_NEW_IMAGE,
      handleNewImage as EventListener
    );
    return () => {
      viewportEl.removeEventListener(
        CoreEnums.Events.STACK_NEW_IMAGE,
        handleNewImage as EventListener
      );
    };
  }, [viewport, viewportEl]);

  useStackScrollWheel(viewportEl, stackKey);

  const onFrameChange = useCallback(
    async (frameOneBased: number) => {
      if (!viewportEl || !viewport || imageIds.length <= 1) return false;
      const targetIndex = Math.min(
        imageIds.length - 1,
        Math.max(0, Math.round(Number(frameOneBased) || 1) - 1)
      );

      setCurrentFrame(targetIndex + 1);

      try {
        await csCoreUtilities.jumpToSlice(viewportEl, {
          imageIndex: targetIndex,
          debounceLoading: true,
        });
        return true;
      } catch {
        try {
          await viewport.setImageIdIndex(targetIndex);
          return true;
        } catch {
          return false;
        }
      }
    },
    [imageIds.length, viewport, viewportEl]
  );

  return {
    elementRef,
    viewport,
    viewportEl,
    currentFrame,
    loading,
    imageAvailable,
    error,
    onFrameChange,
  };
}

export default useSecondaryStackViewport;

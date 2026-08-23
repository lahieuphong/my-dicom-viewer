'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Enums as CoreEnums,
  StackViewport,
  utilities as csCoreUtilities,
} from '@cornerstonejs/core';
import { ToolGroupManager } from '@cornerstonejs/tools';

import { TOOL_GROUP } from '@/constants/toolgroup';
import { initCornerstone } from '@/lib/cornerstone';
import { enableElement } from '@/lib/cornerstone/element';
import {
  getRenderingEngine,
  RENDERER_ID,
} from '@/lib/cornerstone/renderer';
import { useStackScrollWheel } from '@/hooks/useStackScrollWheel';

type VoiRange = { lower: number; upper: number };

type UseSecondaryStackViewportOptions = {
  viewportId: string;
  imageIds: readonly string[];
  stackKey: string;
  voiRange?: VoiRange | null;
};

const VIEWPORT_BACKGROUND: [number, number, number] = [0, 0, 0];
const RENDER_RETRY_DELAYS_MS = [0, 80, 180, 360, 720] as const;
const RENDER_EVENT_TIMEOUT_MS = 900;

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

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function waitForImageRendered(
  element: HTMLDivElement,
  viewportId: string,
  timeoutMs: number
) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (rendered: boolean) => {
      if (settled) return;
      settled = true;
      element.removeEventListener(
        CoreEnums.Events.IMAGE_RENDERED,
        handleImageRendered as EventListener
      );
      window.clearTimeout(timeoutId);
      resolve(rendered);
    };
    const handleImageRendered = (event: Event) => {
      const renderedViewportId = (
        event as CustomEvent<{ viewportId?: string }>
      ).detail?.viewportId;
      if (renderedViewportId && renderedViewportId !== viewportId) return;
      finish(true);
    };
    const timeoutId = window.setTimeout(
      () => finish(false),
      timeoutMs
    );

    element.addEventListener(
      CoreEnums.Events.IMAGE_RENDERED,
      handleImageRendered as EventListener
    );
  });
}

function hasRenderedExpectedImage(
  viewport: StackViewport,
  expectedImageIds: ReadonlySet<string>
) {
  const currentImageId = viewport.getCurrentImageId?.();
  const canvas = viewport.getCanvas?.();
  return Boolean(
    currentImageId &&
      expectedImageIds.has(currentImageId) &&
      canvas &&
      canvas.width > 1 &&
      canvas.height > 1 &&
      viewport.viewportStatus === CoreEnums.ViewportStatus.RENDERED
  );
}

async function renderViewportUntilReady({
  viewport,
  viewportId,
  element,
  expectedImageIds,
  isCancelled,
}: {
  viewport: StackViewport;
  viewportId: string;
  element: HTMLDivElement;
  expectedImageIds: ReadonlySet<string>;
  isCancelled: () => boolean;
}) {
  for (const retryDelay of RENDER_RETRY_DELAYS_MS) {
    if (isCancelled()) return false;
    if (retryDelay > 0) await wait(retryDelay);
    if (isCancelled()) return false;

    const renderedEvent = waitForImageRendered(
      element,
      viewportId,
      RENDER_EVENT_TIMEOUT_MS
    );

    try {
      const renderingEngine = getRenderingEngine(RENDERER_ID);
      // `immediate=true` is important for ContextPoolRenderingEngine: it
      // resizes every onscreen canvas and flushes all pending render flags.
      renderingEngine.resize(true, true);
      viewport.render();
      renderingEngine.renderViewport(viewportId);
    } catch {
      try { viewport.render(); } catch {}
    }

    const receivedRenderEvent = await renderedEvent;
    if (
      !isCancelled() &&
      (receivedRenderEvent ||
        hasRenderedExpectedImage(viewport, expectedImageIds))
    ) {
      return true;
    }
  }

  return !isCancelled() && hasRenderedExpectedImage(
    viewport,
    expectedImageIds
  );
}

function removeViewportFromToolGroup(
  renderingEngineId: string,
  viewportId: string
) {
  try {
    ToolGroupManager.getToolGroup(TOOL_GROUP)?.removeViewports(
      renderingEngineId,
      viewportId
    );
  } catch {}
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
  voiRange = null,
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
    let mountedEngineId: string | null = null;

    void (async () => {
      try {
        await initCornerstone();
        if (cancelled) return;

        const element = elementRef.current;
        if (!element) return;

        const renderingEngine = getRenderingEngine(RENDERER_ID);
        mountedEngineId = renderingEngine.id;

        try {
          const existing = renderingEngine.getViewport(viewportId);
          if (existing?.element !== element) {
            removeViewportFromToolGroup(renderingEngine.id, viewportId);
            renderingEngine.disableElement(viewportId);
          }
        } catch {}

        if (cancelled) return;
        let stackViewport: StackViewport | null = null;
        try {
          const existing = renderingEngine.getViewport(viewportId);
          if (existing?.element === element) {
            stackViewport = existing as StackViewport;
          }
        } catch {}

        if (!stackViewport) {
          renderingEngine.enableElement({
            viewportId,
            type: CoreEnums.ViewportType.STACK,
            element,
            defaultOptions: { background: VIEWPORT_BACKGROUND },
          });
          stackViewport = renderingEngine.getStackViewport(
            viewportId
          ) as StackViewport;
        }

        enableElement(element);
        try {
          element.dataset.viewportRole = 'content';
          element.dataset.viewportUid = viewportId;
        } catch {}

        const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP);
        const viewportIds = toolGroup?.getViewportIds?.() ?? [];
        if (toolGroup && !viewportIds.includes(viewportId)) {
          toolGroup.addViewport(viewportId, renderingEngine.id);
        }

        if (cancelled) return;
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
      try {
        const renderingEngine = getRenderingEngine(RENDERER_ID);
        const renderingEngineId = mountedEngineId ?? renderingEngine.id;
        removeViewportFromToolGroup(renderingEngineId, viewportId);
        renderingEngine.disableElement(viewportId);
      } catch {}
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

        if (voiRange) {
          try { viewport.setProperties({ voiRange }); } catch {}
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
  }, [imageIdsSignature, stackKey, viewport, viewportId, voiRange]);

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

      try {
        viewportEl.dataset.__lastUserInteraction = String(Date.now());
      } catch {}
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

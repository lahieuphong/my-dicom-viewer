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
        try {
          const renderingEngine = getRenderingEngine(RENDERER_ID);
          renderingEngine.resize(false, true);
          renderingEngine.renderViewport(viewportId);
        } catch {
          viewport.render();
        }

        if (!cancelled) {
          setCurrentFrame((viewport.getCurrentImageIdIndex?.() ?? 0) + 1);
          setImageAvailable(true);
          setLoading(false);
        }
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

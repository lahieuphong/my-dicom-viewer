'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  Enums as CoreEnums,
  type StackViewport,
} from '@cornerstonejs/core';
import {
  Enums as ToolEnums,
  ToolGroupManager,
  WindowLevelTool,
} from '@cornerstonejs/tools';

import { TOOL_GROUP } from '@/constants/toolgroup';

type VoiRange = {
  lower: number;
  upper: number;
};

type UseStackVoiPersistenceOptions = {
  viewportInstance: StackViewport | null;
  viewportEl: HTMLDivElement | null;
  stackKey?: string | null;
};

function isValidVoiRange(value: unknown): value is VoiRange {
  if (!value || typeof value !== 'object') return false;
  const range = value as Partial<VoiRange>;
  return (
    Number.isFinite(range.lower) &&
    Number.isFinite(range.upper) &&
    Number(range.upper) > Number(range.lower)
  );
}

function rangesEqual(a: VoiRange | undefined, b: VoiRange): boolean {
  if (!a) return false;
  return (
    Math.abs(a.lower - b.lower) < 0.001 &&
    Math.abs(a.upper - b.upper) < 0.001
  );
}

/**
 * Keeps a user-selected Window/Level range stable while a stack changes image.
 *
 * Cornerstone's GPU stack keeps this presentation itself. Its CPU fallback can
 * restore each image's metadata VOI, so we retain only a confirmed WindowLevel
 * interaction and re-apply it after STACK_NEW_IMAGE has fully settled.
 */
export function useStackVoiPersistence({
  viewportInstance,
  viewportEl,
  stackKey,
}: UseStackVoiPersistenceOptions) {
  const userVoiRef = useRef<VoiRange | null>(null);
  const clearPersistedVoi = useCallback(() => {
    // This also invalidates any STACK_NEW_IMAGE microtask that captured the
    // previous object reference before Reset View was requested.
    userVoiRef.current = null;
  }, []);

  useEffect(() => {
    userVoiRef.current = null;
    if (!viewportInstance || !viewportEl) return;

    let disposed = false;
    let sawTouchDrag = false;

    const isWindowLevelActive = () => {
      try {
        const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP);
        return (
          toolGroup?.getActivePrimaryMouseButtonTool?.() ===
          WindowLevelTool.toolName
        );
      } catch {
        return false;
      }
    };

    const rememberCurrentVoi = () => {
      if (!isWindowLevelActive()) return;
      try {
        const range = viewportInstance.getProperties?.().voiRange;
        if (isValidVoiRange(range)) {
          userVoiRef.current = {
            lower: range.lower,
            upper: range.upper,
          };
        }
      } catch {}
    };

    const handleMouseUp = (event: Event) => {
      const mouseButton = (
        event as CustomEvent<{ mouseButton?: number }>
      ).detail?.mouseButton;
      if (mouseButton !== ToolEnums.MouseBindings.Primary) return;
      rememberCurrentVoi();
    };

    const handleTouchDrag = (event: Event) => {
      const currentPoints = (
        event as CustomEvent<{ currentPointsList?: unknown[] }>
      ).detail?.currentPointsList;
      sawTouchDrag = Array.isArray(currentPoints) && currentPoints.length === 1;
    };

    const handleTouchEnd = () => {
      if (sawTouchDrag) rememberCurrentVoi();
      sawTouchDrag = false;
    };

    const handleStackNewImage = (event: Event) => {
      const savedRange = userVoiRef.current;
      if (!savedRange) return;

      const detail = (
        event as CustomEvent<{ imageIdIndex?: number; imageId?: string }>
      ).detail;
      const eventIndex = detail?.imageIdIndex;
      const eventImageId = detail?.imageId;

      queueMicrotask(() => {
        if (disposed || userVoiRef.current !== savedRange) return;

        try {
          if (Number.isInteger(eventIndex)) {
            const currentIndex = viewportInstance.getCurrentImageIdIndex?.();
            if (currentIndex !== eventIndex) return;
          }
          if (
            eventImageId &&
            viewportInstance.getCurrentImageId?.() !== eventImageId
          ) {
            return;
          }

          const currentRange = viewportInstance.getProperties?.().voiRange;
          if (rangesEqual(currentRange, savedRange)) return;

          viewportInstance.setProperties?.(
            {
              voiRange: {
                lower: savedRange.lower,
                upper: savedRange.upper,
              },
            },
            true
          );
          viewportInstance.render?.();
        } catch {}
      });
    };

    viewportEl.addEventListener(
      ToolEnums.Events.MOUSE_UP,
      handleMouseUp as EventListener
    );
    viewportEl.addEventListener(
      ToolEnums.Events.TOUCH_DRAG,
      handleTouchDrag as EventListener
    );
    viewportEl.addEventListener(
      ToolEnums.Events.TOUCH_END,
      handleTouchEnd as EventListener
    );
    viewportEl.addEventListener(
      CoreEnums.Events.STACK_NEW_IMAGE,
      handleStackNewImage as EventListener
    );

    return () => {
      disposed = true;
      viewportEl.removeEventListener(
        ToolEnums.Events.MOUSE_UP,
        handleMouseUp as EventListener
      );
      viewportEl.removeEventListener(
        ToolEnums.Events.TOUCH_DRAG,
        handleTouchDrag as EventListener
      );
      viewportEl.removeEventListener(
        ToolEnums.Events.TOUCH_END,
        handleTouchEnd as EventListener
      );
      viewportEl.removeEventListener(
        CoreEnums.Events.STACK_NEW_IMAGE,
        handleStackNewImage as EventListener
      );
    };
  }, [stackKey, viewportEl, viewportInstance]);

  return clearPersistedVoi;
}

export default useStackVoiPersistence;

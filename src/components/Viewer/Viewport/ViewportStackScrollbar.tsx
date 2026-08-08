'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Enums as CoreEnums, getEnabledElement } from '@cornerstonejs/core';

import { VIEWPORT_ID } from '@/constants/viewport';
import { cn } from '@/lib/utils';

type ViewportStackScrollbarProps = {
  currentFrame: number;
  totalFrames: number;
  onFrameChange: (frame: number) => boolean | void | Promise<boolean | void>;
  viewportEl?: HTMLDivElement | null;
  disabled?: boolean;
};

const MIN_THUMB_HEIGHT = 42;

function clampFrame(frame: number, totalFrames: number) {
  return Math.min(totalFrames, Math.max(1, Math.round(Number(frame) || 1)));
}

function readViewportFrame(
  viewportEl: HTMLDivElement | null,
  totalFrames: number
) {
  if (!viewportEl || totalFrames <= 0) return null;
  try {
    const viewport = getEnabledElement(viewportEl)?.viewport as {
      getCurrentImageIdIndex?: () => number;
    };
    const imageIndex = viewport?.getCurrentImageIdIndex?.();
    return Number.isInteger(imageIndex)
      ? clampFrame(Number(imageIndex) + 1, totalFrames)
      : null;
  } catch {
    return null;
  }
}

export default function ViewportStackScrollbar({
  currentFrame,
  totalFrames,
  onFrameChange,
  viewportEl = null,
  disabled = false,
}: ViewportStackScrollbarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; grabOffset: number } | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  const stackSyncFrameRef = useRef<number | null>(null);
  const pendingStackFrameRef = useRef<number | null>(null);
  const normalizedTotal = Math.max(0, Math.floor(Number(totalFrames) || 0));
  const normalizedFrame =
    normalizedTotal > 0 ? clampFrame(currentFrame, normalizedTotal) : 1;
  const displayFrameRef = useRef(normalizedFrame);
  const [displayFrame, setDisplayFrame] = useState(normalizedFrame);
  const [isDragging, setIsDragging] = useState(false);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  useEffect(() => {
    if (dragRef.current) return;
    displayFrameRef.current = normalizedFrame;
    setDisplayFrame(normalizedFrame);
  }, [normalizedFrame]);

  useEffect(() => {
    if (!viewportEl || normalizedTotal <= 1) return;

    const commitPendingStackFrame = () => {
      stackSyncFrameRef.current = null;
      const nextFrame = pendingStackFrameRef.current;
      pendingStackFrameRef.current = null;
      if (nextFrame == null || dragRef.current) return;

      setDisplayFrame((current) =>
        current === nextFrame ? current : nextFrame
      );
    };

    const queueStackFrame = (frame: number) => {
      if (dragRef.current) return;
      const nextFrame = clampFrame(frame, normalizedTotal);

      // Keep imperative interactions on the newest rendered frame even when
      // several Cine events arrive before the browser's next paint.
      displayFrameRef.current = nextFrame;
      pendingStackFrameRef.current = nextFrame;

      if (stackSyncFrameRef.current == null) {
        stackSyncFrameRef.current = window.requestAnimationFrame(
          commitPendingStackFrame
        );
      }
    };

    const handleStackNewImage = (event: Event) => {
      const imageIndex = (
        event as CustomEvent<{ imageIdIndex?: number }>
      ).detail?.imageIdIndex;
      if (!Number.isInteger(imageIndex)) return;

      queueStackFrame(Number(imageIndex) + 1);
    };

    viewportEl.addEventListener(
      CoreEnums.Events.STACK_NEW_IMAGE,
      handleStackNewImage as EventListener
    );

    // The parent intentionally pauses its frame-state updates during Cine.
    // Read Cornerstone once when subscribing so a remount never starts from
    // that deliberately frozen prop value.
    const viewportFrame = readViewportFrame(viewportEl, normalizedTotal);
    if (viewportFrame != null) queueStackFrame(viewportFrame);

    return () => {
      viewportEl.removeEventListener(
        CoreEnums.Events.STACK_NEW_IMAGE,
        handleStackNewImage as EventListener
      );
      if (stackSyncFrameRef.current != null) {
        window.cancelAnimationFrame(stackSyncFrameRef.current);
        stackSyncFrameRef.current = null;
      }
      pendingStackFrameRef.current = null;
    };
  }, [normalizedTotal, viewportEl]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current != null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      if (stackSyncFrameRef.current != null) {
        window.cancelAnimationFrame(stackSyncFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!disabled) return;

    const drag = dragRef.current;
    dragRef.current = null;
    pendingFrameRef.current = null;
    setIsDragging(false);

    if (animationFrameRef.current != null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (stackSyncFrameRef.current != null) {
      window.cancelAnimationFrame(stackSyncFrameRef.current);
      stackSyncFrameRef.current = null;
    }
    pendingStackFrameRef.current = null;

    const actualFrame =
      readViewportFrame(viewportEl, normalizedTotal) ?? normalizedFrame;
    displayFrameRef.current = actualFrame;
    setDisplayFrame(actualFrame);

    if (
      drag &&
      trackRef.current?.hasPointerCapture?.(drag.pointerId)
    ) {
      try {
        trackRef.current.releasePointerCapture(drag.pointerId);
      } catch {}
    }
  }, [disabled, normalizedFrame, normalizedTotal, viewportEl]);

  const requestFrame = useCallback(
    (frame: number) => {
      if (disabled || normalizedTotal <= 1) return;

      const nextFrame = clampFrame(frame, normalizedTotal);
      displayFrameRef.current = nextFrame;
      setDisplayFrame(nextFrame);
      pendingFrameRef.current = nextFrame;

      if (animationFrameRef.current != null) return;
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        const pendingFrame = pendingFrameRef.current;
        pendingFrameRef.current = null;
        if (pendingFrame == null || disabledRef.current) return;

        try {
          const result = onFrameChange(pendingFrame);
          if (result instanceof Promise) void result.catch(() => {});
        } catch {}
      });
    },
    [disabled, normalizedTotal, onFrameChange]
  );

  const getFrameAtPosition = useCallback(
    (clientY: number, grabOffset: number) => {
      const track = trackRef.current;
      const thumb = thumbRef.current;
      if (!track || !thumb || normalizedTotal <= 1) return normalizedFrame;

      const trackRect = track.getBoundingClientRect();
      const thumbHeight = thumb.getBoundingClientRect().height;
      const maxThumbTop = Math.max(0, trackRect.height - thumbHeight);
      if (maxThumbTop <= 0) return normalizedFrame;

      const thumbTop = Math.min(
        maxThumbTop,
        Math.max(0, clientY - trackRect.top - grabOffset)
      );
      return Math.round((thumbTop / maxThumbTop) * (normalizedTotal - 1)) + 1;
    },
    [normalizedFrame, normalizedTotal]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || normalizedTotal <= 1 || !thumbRef.current) return;

      event.preventDefault();
      event.stopPropagation();
      const thumbRect = thumbRef.current.getBoundingClientRect();
      const isOnThumb = event.clientY >= thumbRect.top && event.clientY <= thumbRect.bottom;
      const grabOffset = isOnThumb
        ? event.clientY - thumbRect.top
        : thumbRect.height / 2;

      dragRef.current = { pointerId: event.pointerId, grabOffset };
      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);

      if (!isOnThumb) {
        requestFrame(getFrameAtPosition(event.clientY, grabOffset));
      }
    },
    [disabled, getFrameAtPosition, normalizedTotal, requestFrame]
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      event.preventDefault();
      event.stopPropagation();
      requestFrame(getFrameAtPosition(event.clientY, drag.grabOffset));
    },
    [getFrameAtPosition, requestFrame]
  );

  const finishPointerInteraction = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (dragRef.current?.pointerId !== event.pointerId) return;

      dragRef.current = null;
      setIsDragging(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    []
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const pageStep = Math.max(1, Math.round(normalizedTotal * 0.1));
      const keyTargetMap: Record<string, number> = {
        ArrowDown: displayFrameRef.current + 1,
        ArrowRight: displayFrameRef.current + 1,
        ArrowUp: displayFrameRef.current - 1,
        ArrowLeft: displayFrameRef.current - 1,
        PageDown: displayFrameRef.current + pageStep,
        PageUp: displayFrameRef.current - pageStep,
        Home: 1,
        End: normalizedTotal,
      };
      const targetFrame = keyTargetMap[event.key];
      if (typeof targetFrame !== 'number') return;

      event.preventDefault();
      event.stopPropagation();
      requestFrame(targetFrame);
    },
    [normalizedTotal, requestFrame]
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
      if (delta === 0) return;

      event.preventDefault();
      event.stopPropagation();
      requestFrame(displayFrameRef.current + (delta > 0 ? 1 : -1));
    },
    [requestFrame]
  );

  if (normalizedTotal <= 1) return null;

  const positionRatio = (displayFrame - 1) / (normalizedTotal - 1);
  const positionPercent = positionRatio * 100;
  const relativeThumbHeight = 100 / normalizedTotal;

  return (
    <div
      ref={trackRef}
      role="scrollbar"
      aria-label="Điều hướng lát cắt DICOM"
      aria-controls={`${VIEWPORT_ID}-element`}
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={normalizedTotal}
      aria-valuenow={displayFrame}
      aria-valuetext={`Ảnh ${displayFrame} trên ${normalizedTotal}`}
      tabIndex={disabled ? -1 : 0}
      className={cn(
        'group pointer-events-auto absolute right-1 top-2 bottom-2 z-20 w-3 touch-none select-none rounded-full outline-none',
        'focus-visible:ring-2 focus-visible:ring-blue-400/90 focus-visible:ring-offset-1 focus-visible:ring-offset-black',
        disabled ? 'cursor-default opacity-45' : 'cursor-pointer'
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerInteraction}
      onPointerCancel={finishPointerInteraction}
      onLostPointerCapture={finishPointerInteraction}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
    >
      <div className="pointer-events-none absolute inset-y-0 right-0 w-2 rounded-full bg-white/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">
        <div
          ref={thumbRef}
          className={cn(
            'absolute left-0 right-0 rounded-full bg-slate-300/80 shadow-[0_0_10px_rgba(147,197,253,0.28)]',
            'transition-colors duration-75 ease-linear group-hover:bg-slate-200 group-focus-visible:bg-blue-200',
            isDragging
              ? 'bg-blue-200'
              : undefined
          )}
          style={{
            height: `min(100%, max(${MIN_THUMB_HEIGHT}px, ${relativeThumbHeight}%))`,
            top: `${positionPercent}%`,
            transform: `translateY(-${positionPercent}%)`,
          }}
        />
      </div>
    </div>
  );
}

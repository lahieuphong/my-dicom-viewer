'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { VIEWPORT_ID } from '@/constants/viewport';
import { cn } from '@/lib/utils';

type ViewportStackScrollbarProps = {
  currentFrame: number;
  totalFrames: number;
  onFrameChange: (frame: number) => boolean | void | Promise<boolean | void>;
  disabled?: boolean;
};

const MIN_THUMB_HEIGHT = 42;

function clampFrame(frame: number, totalFrames: number) {
  return Math.min(totalFrames, Math.max(1, Math.round(Number(frame) || 1)));
}

export default function ViewportStackScrollbar({
  currentFrame,
  totalFrames,
  onFrameChange,
  disabled = false,
}: ViewportStackScrollbarProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; grabOffset: number } | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  const normalizedTotal = Math.max(0, Math.floor(Number(totalFrames) || 0));
  const normalizedFrame =
    normalizedTotal > 0 ? clampFrame(currentFrame, normalizedTotal) : 1;
  const displayFrameRef = useRef(normalizedFrame);
  const [displayFrame, setDisplayFrame] = useState(normalizedFrame);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (dragRef.current) return;
    displayFrameRef.current = normalizedFrame;
    setDisplayFrame(normalizedFrame);
  }, [normalizedFrame]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current != null) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

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
        if (pendingFrame == null) return;

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
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
    >
      <div className="pointer-events-none absolute inset-y-0 right-0 w-2 rounded-full bg-white/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">
        <div
          ref={thumbRef}
          className={cn(
            'absolute left-0 right-0 rounded-full bg-slate-300/80 shadow-[0_0_10px_rgba(147,197,253,0.28)]',
            'group-hover:bg-slate-200 group-focus-visible:bg-blue-200',
            isDragging
              ? 'bg-blue-200 transition-colors'
              : 'transition-[top,transform,background-color] duration-75 ease-linear'
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

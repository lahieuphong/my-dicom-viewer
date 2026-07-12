'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

type PanelScrollAreaProps = {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  scrollbarVisibility?: 'auto' | 'always';
};

type ScrollMetrics = {
  canScroll: boolean;
  thumbHeight: number;
  thumbTop: number;
};

const TRACK_INSET = 8;
const MIN_THUMB_HEIGHT = 42;

export default function PanelScrollArea({
  children,
  className,
  contentClassName,
  scrollbarVisibility = 'auto',
}: PanelScrollAreaProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startY: number; startScrollTop: number } | null>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics>({
    canScroll: false,
    thumbHeight: 0,
    thumbTop: 0,
  });

  const calculateMetrics = useCallback((): ScrollMetrics => {
    const el = scrollRef.current;
    if (!el) {
      return { canScroll: false, thumbHeight: 0, thumbTop: 0 };
    }

    const maxScroll = el.scrollHeight - el.clientHeight;
    const canScroll = maxScroll > 1;
    if (!canScroll) {
      if (el.scrollTop !== 0) el.scrollTop = 0;
      return { canScroll: false, thumbHeight: 0, thumbTop: 0 };
    }

    if (el.scrollTop > maxScroll) el.scrollTop = maxScroll;
    if (el.scrollTop < 0) el.scrollTop = 0;

    const trackHeight = Math.max(0, el.clientHeight - TRACK_INSET * 2);
    const thumbHeight = Math.min(
      trackHeight,
      Math.max(MIN_THUMB_HEIGHT, (el.clientHeight / el.scrollHeight) * trackHeight)
    );
    const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
    const thumbTop = maxThumbTop <= 0 ? 0 : (el.scrollTop / maxScroll) * maxThumbTop;

    return { canScroll, thumbHeight, thumbTop };
  }, []);

  const updateMetrics = useCallback(() => {
    const next = calculateMetrics();
    setMetrics((prev) =>
      prev.canScroll === next.canScroll &&
      Math.abs(prev.thumbHeight - next.thumbHeight) < 0.5 &&
      Math.abs(prev.thumbTop - next.thumbTop) < 0.5
        ? prev
        : next
    );
  }, [calculateMetrics]);

  const scrollByDelta = useCallback(
    (delta: number) => {
      const el = scrollRef.current;
      if (!el || delta === 0) return false;

      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll <= 1) return false;

      const previousTop = el.scrollTop;
      const nextTop = Math.min(maxScroll, Math.max(0, previousTop + delta));
      if (nextTop === previousTop) return false;

      el.scrollTop = nextTop;
      updateMetrics();
      return true;
    },
    [updateMetrics]
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    updateMetrics();
    const frame = window.requestAnimationFrame(updateMetrics);
    el.addEventListener('scroll', updateMetrics, { passive: true });

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(updateMetrics)
        : null;
    observer?.observe(el);
    if (contentRef.current) observer?.observe(contentRef.current);

    return () => {
      window.cancelAnimationFrame(frame);
      el.removeEventListener('scroll', updateMetrics);
      observer?.disconnect();
    };
  }, [children, updateMetrics]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const handleNativeWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!scrollByDelta(delta)) return;

      event.preventDefault();
      event.stopPropagation();
    };

    root.addEventListener('wheel', handleNativeWheel, {
      capture: true,
      passive: false,
    });

    return () => {
      root.removeEventListener('wheel', handleNativeWheel, { capture: true });
    };
  }, [scrollByDelta]);

  const setScrollFromTrackPosition = useCallback((clientY: number) => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;

    const nextMetrics = calculateMetrics();
    if (!nextMetrics.canScroll) return;

    const rect = track.getBoundingClientRect();
    const maxScroll = el.scrollHeight - el.clientHeight;
    const maxThumbTop = Math.max(0, rect.height - nextMetrics.thumbHeight);
    const targetTop = Math.min(
      maxThumbTop,
      Math.max(0, clientY - rect.top - nextMetrics.thumbHeight / 2)
    );

    el.scrollTop = maxThumbTop <= 0 ? 0 : (targetTop / maxThumbTop) * maxScroll;
  }, [calculateMetrics]);

  const handleTrackPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setScrollFromTrackPosition(event.clientY);
    },
    [setScrollFromTrackPosition]
  );

  const handleThumbPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      if (!el) return;

      event.preventDefault();
      event.stopPropagation();
      dragRef.current = {
        startY: event.clientY,
        startScrollTop: el.scrollTop,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    []
  );

  const handleThumbPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      const drag = dragRef.current;
      if (!el || !drag) return;

      event.preventDefault();
      const nextMetrics = calculateMetrics();
      if (!nextMetrics.canScroll) return;

      const trackHeight = Math.max(0, el.clientHeight - TRACK_INSET * 2);
      const maxThumbTop = Math.max(0, trackHeight - nextMetrics.thumbHeight);
      const maxScroll = el.scrollHeight - el.clientHeight;
      const deltaY = event.clientY - drag.startY;
      const deltaScroll = maxThumbTop <= 0 ? 0 : (deltaY / maxThumbTop) * maxScroll;

      el.scrollTop = drag.startScrollTop + deltaScroll;
    },
    [calculateMetrics]
  );

  const handleThumbPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const el = scrollRef.current;
      if (!el) return;

      const maxScroll = el.scrollHeight - el.clientHeight;
      if (maxScroll <= 1) return;

      const pageStep = Math.max(80, el.clientHeight * 0.85);
      const keyScrollMap: Record<string, number> = {
        ArrowDown: 48,
        ArrowUp: -48,
        PageDown: pageStep,
        PageUp: -pageStep,
        Home: -maxScroll,
        End: maxScroll,
      };
      const delta = keyScrollMap[event.key];
      if (typeof delta !== 'number') return;

      const previousTop = el.scrollTop;
      const nextTop = Math.min(maxScroll, Math.max(0, previousTop + delta));
      if (nextTop === previousTop) return;

      event.preventDefault();
      event.stopPropagation();
      el.scrollTop = nextTop;
      updateMetrics();
    },
    [updateMetrics]
  );

  return (
    <div ref={rootRef} className={cn('relative flex min-h-0 flex-1 flex-col overflow-hidden', className)}>
      <div
        ref={scrollRef}
        className="viewer-panel-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pr-4 focus:outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div ref={contentRef} className={contentClassName}>
          {children}
        </div>
      </div>

      {(metrics.canScroll || scrollbarVisibility === 'always') && (
        <div
          ref={trackRef}
          className="absolute right-1 top-2 bottom-2 z-20 w-2 rounded-full bg-white/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]"
          onPointerDown={handleTrackPointerDown}
          aria-hidden="true"
        >
          <div
            className={cn(
              'absolute left-0 right-0 rounded-full bg-slate-300/80 shadow-[0_0_10px_rgba(147,197,253,0.28)] transition-colors',
              metrics.canScroll
                ? 'cursor-grab active:cursor-grabbing active:bg-blue-200'
                : 'cursor-default opacity-55'
            )}
            style={{
              height: metrics.canScroll ? `${metrics.thumbHeight}px` : '100%',
              transform: metrics.canScroll ? `translateY(${metrics.thumbTop}px)` : 'translateY(0)',
            }}
            onPointerDown={handleThumbPointerDown}
            onPointerMove={handleThumbPointerMove}
            onPointerUp={handleThumbPointerUp}
            onPointerCancel={handleThumbPointerUp}
          />
        </div>
      )}
    </div>
  );
}

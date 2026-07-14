'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export function useBatchedFrameState(initialFrame = 1, minIntervalMs = 66) {
  const [currentFrame, setCurrentFrame] = useState(initialFrame);
  const currentFrameRef = useRef(initialFrame);
  const frameUiTimerRef = useRef<number | null>(null);
  const pendingFrameRef = useRef<number | null>(null);
  const lastFrameUiUpdateRef = useRef(0);

  useEffect(() => {
    currentFrameRef.current = currentFrame;
  }, [currentFrame]);

  useEffect(() => {
    return () => {
      if (frameUiTimerRef.current != null) {
        window.clearTimeout(frameUiTimerRef.current);
        frameUiTimerRef.current = null;
      }
    };
  }, []);

  const setCurrentFrameBatched = useCallback((frame: number) => {
    const next = Math.max(1, Math.floor(Number(frame) || 1));
    pendingFrameRef.current = next;

    const commit = () => {
      frameUiTimerRef.current = null;
      const pending = pendingFrameRef.current;
      pendingFrameRef.current = null;
      if (typeof pending !== 'number' || currentFrameRef.current === pending) return;
      currentFrameRef.current = pending;
      lastFrameUiUpdateRef.current = performance.now();
      setCurrentFrame(pending);
    };

    const now = performance.now();
    const elapsed = now - lastFrameUiUpdateRef.current;

    if (elapsed >= minIntervalMs && frameUiTimerRef.current == null) {
      commit();
      return;
    }

    if (frameUiTimerRef.current == null) {
      frameUiTimerRef.current = window.setTimeout(
        commit,
        Math.max(0, minIntervalMs - elapsed)
      );
    }
  }, [minIntervalMs]);

  return {
    currentFrame,
    setCurrentFrame,
    setCurrentFrameBatched,
  };
}

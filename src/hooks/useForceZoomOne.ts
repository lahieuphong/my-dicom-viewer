'use client';

import { useEffect, useRef } from 'react';
import type { StackViewport } from '@cornerstonejs/core';

type Options = {
  enabled?: boolean;
  delayMs?: number;
};

export function useForceZoomOne(
  viewportInstance: StackViewport | null,
  renderingEngineRef: React.MutableRefObject<any>,
  options: Options = {}
) {
  const { enabled = true, delayMs = 80 } = options;

  const cancelledRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !viewportInstance) return;

    cancelledRef.current = false;

    const forceZoom = () => {
      if (cancelledRef.current) return;

      try {
        viewportInstance.setViewPresentation?.({
          zoom: 1,
          rotation: 0,
        });
      } catch {
        try {
          (viewportInstance as any).setScale?.(1);
        } catch {}
      }

      try {
        renderingEngineRef.current?.resize?.();
        renderingEngineRef.current?.renderViewport?.(
          (viewportInstance as any).id
        );
      } catch {}

      try {
        viewportInstance.render?.();
      } catch {}
    };

    // ⏱ delayed force (after reset / stack set)
    timeoutRef.current = window.setTimeout(forceZoom, delayMs);

    return () => {
      cancelledRef.current = true;
      if (timeoutRef.current != null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [viewportInstance, renderingEngineRef, enabled, delayMs]);
}

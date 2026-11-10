// src/hooks/useFlip.ts

import { MutableRefObject } from 'react';
import { RenderingEngine, StackViewport } from '@cornerstonejs/core';

import { toggleViewportFlipHorizontal } from '@/lib/viewer/viewportActions';

export function useFlipHorizontal(
  renderingEngineRef: MutableRefObject<RenderingEngine | null>,
  viewportId: string
) {
  const flipHorizontal = () => {
    const engine = renderingEngineRef.current;
    if (!engine) return;

    try {
      toggleViewportFlipHorizontal(engine.getViewport(viewportId) as StackViewport);
    } catch {
      // Best-effort while a viewport is mounting/unmounting.
    }
  };

  return flipHorizontal;
}

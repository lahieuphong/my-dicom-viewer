// src/hooks/useFlip.ts

import { MutableRefObject } from 'react';
import { RenderingEngine, StackViewport } from '@cornerstonejs/core';

export function useFlipHorizontal(
  renderingEngineRef: MutableRefObject<RenderingEngine | null>,
  viewportId: string
) {
  const flipHorizontal = () => {
    const engine = renderingEngineRef.current;
    if (!engine) return;

    try {
      const viewport = engine.getViewport(viewportId) as StackViewport;
      const isFlipped = viewport.getCamera().flipHorizontal ?? false;

      // Only mutate the flip flag. Passing the previous full camera here can
      // overwrite the geometry that Cornerstone creates for the flip.
      viewport.setCamera({ flipHorizontal: !isFlipped });
      viewport.render();
    } catch {
    }
  };

  return flipHorizontal;
}

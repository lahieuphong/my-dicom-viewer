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
      const vp = engine.getViewport(viewportId) as StackViewport;
      const pres = vp.getViewPresentation();
      const cam = vp.getCamera();
      const newFlip = !cam.flipHorizontal;

      vp.setCamera({ ...cam, flipHorizontal: newFlip });
      vp.setViewPresentation({
        ...pres,
        pan: pres.pan ?? [0, 0],
        zoom: pres.zoom ?? 1,
        rotation: pres.rotation ?? 0,
      });

      requestAnimationFrame(() => engine.renderViewport(viewportId));
    } catch (e) {
    }
  };

  return flipHorizontal;
}

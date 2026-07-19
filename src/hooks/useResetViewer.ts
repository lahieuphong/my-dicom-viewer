// src/hooks/useResetViewer.ts
'use client';

import { useCallback } from 'react';
import type { StackViewport } from '@cornerstonejs/core';

export function useResetViewer(
  viewportInstance: StackViewport | null,
  clearPersistedVoi?: () => void
) {
  return useCallback(() => {
    if (!viewportInstance) return;

    try {
      // A user-selected VOI is intentionally kept while scrolling the stack.
      // Clear it first so it cannot overwrite the image default after reset.
      clearPersistedVoi?.();

      // Match OHIF Reset View semantics: restore the current image's default
      // VOI/display properties, then reset the camera to its fitted position.
      viewportInstance.resetProperties();

      // resetCamera also resets rotation on the GPU path. Cornerstone's CPU
      // fallback does not, so normalise it through the public presentation API.
      const presentation = viewportInstance.getViewPresentation();
      viewportInstance.setViewPresentation({
        ...presentation,
        rotation: 0,
      });

      viewportInstance.resetCamera({
        resetPan: true,
        resetZoom: true,
        resetToCenter: true,
      });

      // Keep Cornerstone's public flip state in sync in the CPU fallback too.
      viewportInstance.setCamera({
        flipHorizontal: false,
        flipVertical: false,
      });
      viewportInstance.render();
    } catch {
      // The toolbar action is best-effort while a viewport is mounting/unmounting.
    }
  }, [clearPersistedVoi, viewportInstance]);
}

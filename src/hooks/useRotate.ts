// src/hooks/useRotate.ts
import type { StackViewport } from '@cornerstonejs/core';

import { rotateViewportClockwise } from '@/lib/viewer/viewportActions';

export function useRotate(viewportInstance: StackViewport | null) {
  const rotate = async () => {
    if (!viewportInstance) return;
    try {
      rotateViewportClockwise(viewportInstance);
    } catch {
      // Best-effort while a viewport is mounting/unmounting.
    }
  };

  return rotate;
}

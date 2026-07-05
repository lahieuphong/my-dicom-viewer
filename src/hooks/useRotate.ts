// src/hooks/useRotate.ts
import { StackViewport } from '@cornerstonejs/core';

export function useRotate(viewportInstance: StackViewport | null) {
  const rotate = async () => {
    if (!viewportInstance) return;
    try {
      const pres = viewportInstance.getViewPresentation();
      pres.rotation = ((pres.rotation ?? 0) + 90) % 360;
      viewportInstance.setViewPresentation(pres);
      viewportInstance.render();
    } catch (e) {
    }
  };

  return rotate;
}
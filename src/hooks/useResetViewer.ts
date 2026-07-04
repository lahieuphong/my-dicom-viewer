// src/hooks/useResetViewer.ts
import { StackViewport } from '@cornerstonejs/core';

export function useResetViewer(
  resetToInitial: (viewport: StackViewport | null) => Promise<void>,
  viewportInstance: StackViewport | null
) {
  return async () => {
    if (!viewportInstance) return;
    try {
      await resetToInitial(viewportInstance);
    } catch (e) {
      console.error('Reset error:', e);
    }
  };
}

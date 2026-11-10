// src/hooks/useResetViewer.ts
'use client';

import { useCallback } from 'react';
import type { StackViewport } from '@cornerstonejs/core';

import { resetViewportView } from '@/lib/viewer/viewportActions';

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
      resetViewportView(viewportInstance);
    } catch {
      // The toolbar action is best-effort while a viewport is mounting/unmounting.
    }
  }, [clearPersistedVoi, viewportInstance]);
}

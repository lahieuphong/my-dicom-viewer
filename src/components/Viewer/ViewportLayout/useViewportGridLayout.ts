'use client';

import { useCallback, useState } from 'react';

import { VIEWPORT_ID } from '@/constants/viewport';

import {
  DEFAULT_VIEWPORT_LAYOUT,
  getViewportCount,
  getViewportIdAt,
  normalizeViewportLayout,
  type ViewportGridLayout,
} from './viewportLayout';

export function useViewportGridLayout() {
  const [layout, setLayoutState] = useState<ViewportGridLayout>(
    DEFAULT_VIEWPORT_LAYOUT
  );
  const [activeViewportId, setActiveViewportId] = useState(VIEWPORT_ID);

  const setLayout = useCallback((nextLayout: ViewportGridLayout) => {
    const normalized = normalizeViewportLayout(nextLayout);
    const retainedViewportIds = new Set(
      Array.from({ length: getViewportCount(normalized) }, (_, index) =>
        getViewportIdAt(index)
      )
    );

    setLayoutState(normalized);
    setActiveViewportId((current) =>
      retainedViewportIds.has(current) ? current : VIEWPORT_ID
    );
  }, []);

  return {
    layout,
    setLayout,
    activeViewportId,
    setActiveViewportId,
  };
}

export default useViewportGridLayout;

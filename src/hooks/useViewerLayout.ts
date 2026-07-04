// src/hooks/useViewerLayout.ts
'use client';
import { useEffect, useMemo, useState, useCallback } from 'react';

type UseViewerLayoutOpts = {
  /** Tailwind md breakpoint in px; default matches your current logic (768) */
  breakpoint?: number;
  /** width when sidebar expanded (css length string) */
  leftExpanded?: string;
  /** width when sidebar collapsed (css length string) */
  leftCollapsed?: string;
  /** width when measurement panel expanded */
  rightExpanded?: string;
  /** width when measurement panel collapsed */
  rightCollapsed?: string;
  /** initial collapsed state for left sidebar */
  initialSidebarCollapsed?: boolean;
  /** initial collapsed state for right measurement panel */
  initialMeasurementCollapsed?: boolean;
};

/**
 * useViewerLayout
 *
 * Encapsulate grid column calculation + responsive resize listener + collapsed toggles.
 *
 * Returns:
 *  - gridCols: string ready for `gridTemplateColumns`
 *  - sidebarCollapsed, setSidebarCollapsed
 *  - measurementCollapsed, setMeasurementCollapsed
 *
 * NOTE: This intentionally doesn't manage mobile drawer booleans (mobileSeriesOpen / mobileMeasurementsOpen)
 * which are kept in the component.
 */
export function useViewerLayout(opts: UseViewerLayoutOpts = {}) {
  const {
    breakpoint = 768,
    leftExpanded = '250px',
    leftCollapsed = '48px',
    rightExpanded = '250px',
    rightCollapsed = '48px',
    initialSidebarCollapsed = false,
    initialMeasurementCollapsed = false,
  } = opts;

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(initialSidebarCollapsed);
  const [measurementCollapsed, setMeasurementCollapsed] = useState<boolean>(initialMeasurementCollapsed);
  const [viewportWidth, setViewportWidth] = useState<number>(() => (typeof window !== 'undefined' ? window.innerWidth : 0));

  // compute gridCols deterministically from the three reactive inputs
  const gridCols = useMemo(() => {
    if (viewportWidth >= breakpoint) {
      const left = sidebarCollapsed ? leftCollapsed : leftExpanded;
      const right = measurementCollapsed ? rightCollapsed : rightExpanded;
      return `${left} 1fr ${right}`;
    }
    return '1fr';
  }, [viewportWidth, breakpoint, sidebarCollapsed, measurementCollapsed, leftCollapsed, leftExpanded, rightCollapsed, rightExpanded]);

  // update width on resize; debounced-ish via requestAnimationFrame to avoid flood
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let rafId: number | null = null;
    const handle = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        setViewportWidth(window.innerWidth);
        rafId = null;
      });
    };

    window.addEventListener('resize', handle);
    // also initialize
    setViewportWidth(window.innerWidth);

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handle);
    };
  }, []);

  // helper to toggle both panels quickly
  const toggleSidebar = useCallback(() => setSidebarCollapsed((s) => !s), []);
  const toggleMeasurement = useCallback(() => setMeasurementCollapsed((s) => !s), []);

  return {
    gridCols,
    sidebarCollapsed,
    setSidebarCollapsed,
    toggleSidebar,
    measurementCollapsed,
    setMeasurementCollapsed,
    toggleMeasurement,
  } as const;
}

export default useViewerLayout;
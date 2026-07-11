// src/hooks/useViewerLayout.ts
'use client';
import { useMemo, useState, useCallback } from 'react';

type UseViewerLayoutOpts = {
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
 * Encapsulate desktop grid column calculation + collapsed toggles.
 *
 * Returns:
 *  - gridCols: desktop column template passed into CSS via a custom property
 *  - sidebarCollapsed, setSidebarCollapsed
 *  - measurementCollapsed, setMeasurementCollapsed
 *
 * NOTE: This intentionally doesn't manage mobile drawer booleans (mobileSeriesOpen / mobileMeasurementsOpen)
 * which are kept in the component.
 */
export function useViewerLayout(opts: UseViewerLayoutOpts = {}) {
  const {
    leftExpanded = '250px',
    leftCollapsed = '48px',
    rightExpanded = '250px',
    rightCollapsed = '48px',
    initialSidebarCollapsed = false,
    initialMeasurementCollapsed = false,
  } = opts;

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(initialSidebarCollapsed);
  const [measurementCollapsed, setMeasurementCollapsed] = useState<boolean>(initialMeasurementCollapsed);

  const gridCols = useMemo(() => {
    const left = sidebarCollapsed ? leftCollapsed : leftExpanded;
    const right = measurementCollapsed ? rightCollapsed : rightExpanded;
    return `${left} minmax(0, 1fr) ${right}`;
  }, [sidebarCollapsed, measurementCollapsed, leftCollapsed, leftExpanded, rightCollapsed, rightExpanded]);

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

// src/hooks/useViewerLayout.ts
'use client';
import { useMemo, useState, useCallback, type SetStateAction } from 'react';

import {
  VIEWER_LEFT_PANEL_COLLAPSED,
  VIEWER_LEFT_PANEL_EXPANDED,
  VIEWER_LEFT_PANEL_MAX,
  VIEWER_LEFT_PANEL_MIN,
  VIEWER_RIGHT_PANEL_COLLAPSED,
  VIEWER_RIGHT_PANEL_EXPANDED,
  VIEWER_RIGHT_PANEL_MAX,
  VIEWER_RIGHT_PANEL_MIN,
} from '@/constants/viewerLayout';

type UseViewerLayoutOpts = {
  /** width when sidebar expanded */
  leftExpanded?: number;
  /** width when sidebar collapsed */
  leftCollapsed?: number;
  /** width when measurement panel expanded */
  rightExpanded?: number;
  /** width when measurement panel collapsed */
  rightCollapsed?: number;
  leftMin?: number;
  leftMax?: number;
  rightMin?: number;
  rightMax?: number;
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
 *  - leftPanelWidth/rightPanelWidth: expanded desktop widths for the resizable panels
 *  - sidebarCollapsed, setSidebarCollapsed
 *  - measurementCollapsed, setMeasurementCollapsed
 *
 * NOTE: This intentionally doesn't manage mobile drawer booleans (mobileSeriesOpen / mobileMeasurementsOpen)
 * which are kept in the component.
 */
export function useViewerLayout(opts: UseViewerLayoutOpts = {}) {
  const {
    leftExpanded = VIEWER_LEFT_PANEL_EXPANDED,
    leftCollapsed = VIEWER_LEFT_PANEL_COLLAPSED,
    rightExpanded = VIEWER_RIGHT_PANEL_EXPANDED,
    rightCollapsed = VIEWER_RIGHT_PANEL_COLLAPSED,
    leftMin = VIEWER_LEFT_PANEL_MIN,
    leftMax = VIEWER_LEFT_PANEL_MAX,
    rightMin = VIEWER_RIGHT_PANEL_MIN,
    rightMax = VIEWER_RIGHT_PANEL_MAX,
    initialSidebarCollapsed = false,
    initialMeasurementCollapsed = false,
  } = opts;

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(initialSidebarCollapsed);
  const [measurementCollapsed, setMeasurementCollapsed] = useState<boolean>(initialMeasurementCollapsed);
  const [leftPanelWidth, setLeftPanelWidthState] = useState(leftExpanded);
  const [rightPanelWidth, setRightPanelWidthState] = useState(rightExpanded);

  const clampLeftPanelWidth = useCallback(
    (width: number) => Math.min(leftMax, Math.max(leftMin, width)),
    [leftMax, leftMin]
  );
  const clampRightPanelWidth = useCallback(
    (width: number) => Math.min(rightMax, Math.max(rightMin, width)),
    [rightMax, rightMin]
  );

  const setLeftPanelWidth = useCallback(
    (next: SetStateAction<number>) => {
      setLeftPanelWidthState((previous) => {
        const value = typeof next === 'function' ? next(previous) : next;
        return clampLeftPanelWidth(value);
      });
    },
    [clampLeftPanelWidth]
  );

  const setRightPanelWidth = useCallback(
    (next: SetStateAction<number>) => {
      setRightPanelWidthState((previous) => {
        const value = typeof next === 'function' ? next(previous) : next;
        return clampRightPanelWidth(value);
      });
    },
    [clampRightPanelWidth]
  );

  const gridCols = useMemo(() => {
    const left = sidebarCollapsed ? leftCollapsed : leftPanelWidth;
    const right = measurementCollapsed ? rightCollapsed : rightPanelWidth;
    return `${left}px minmax(0, 1fr) ${right}px`;
  }, [sidebarCollapsed, measurementCollapsed, leftCollapsed, leftPanelWidth, rightCollapsed, rightPanelWidth]);

  // helper to toggle both panels quickly
  const toggleSidebar = useCallback(() => setSidebarCollapsed((s) => !s), []);
  const toggleMeasurement = useCallback(() => setMeasurementCollapsed((s) => !s), []);

  return {
    gridCols,
    leftPanelWidth,
    setLeftPanelWidth,
    rightPanelWidth,
    setRightPanelWidth,
    sidebarCollapsed,
    setSidebarCollapsed,
    toggleSidebar,
    measurementCollapsed,
    setMeasurementCollapsed,
    toggleMeasurement,
  } as const;
}

export default useViewerLayout;

// src/hooks/useMeasurementSelector.ts
'use client';

import React from 'react';
import { useCallback, useRef } from 'react';
import {
  annotation as csAnnotation,
  utilities as csToolsUtilities,
} from '@cornerstonejs/tools';
import { areImageStacksEqual } from '@/lib/cornerstone/helpers';
import { resolveMeasurementImageIndex } from '@/lib/viewer/measurementImageIndex';
import { ensureAnnotationAvailable } from '@/lib/cornerstone/annotations';
import { cancelActiveAnnotationInteraction } from '@/lib/cornerstone/annotationInteraction';
import { VIEWPORT_ID } from '@/constants/viewport';
import {
  isAnnotationRemovalTombstoned,
  safeAddAnnotation,
} from '@/lib/viewer/annotationHelpers';
import { selectMeasurementAnnotation } from '@/lib/cornerstone/measurementStyles';
import type { AnnotationMeasurement } from '@/hooks/useMeasurements';

function selectCornerstoneAnnotation(annotationUID: string): void {
  selectMeasurementAnnotation(annotationUID);
}

function setSelectedMeasurementUIDIfChanged(
  setter: (uid: string | null) => void,
  selectedRef: React.RefObject<string | null> | undefined,
  uid: string | null
): void {
  try {
    if (
      uid &&
      !(csAnnotation.state as any)?.getAnnotation?.(uid)
    ) {
      return;
    }
    const previous = selectedRef?.current ?? null;
    if (previous !== uid) {
      setter(uid);
    }
  } catch {
    try {
      setter(uid);
    } catch {}
  }
}

export type UseMeasurementSelectorOpts = {
  renderingEngineRef?: { current: any };
  viewportInstance: any | null;
  viewportEl: HTMLDivElement | null;
  viewportId?: string;

  mergedSeriesMapRef: React.RefObject<
    Record<string, { files: string[]; metadata?: unknown }>
  >;
  allMeasurements: AnnotationMeasurement[];
  selectedSeries: string;
  pendingSeriesNavigationRef: React.MutableRefObject<{
    seriesUID: string;
    imageIndex: number;
  } | null>;

  setSelectedSeries: React.Dispatch<React.SetStateAction<string>>;
  setSelectedMeasurementUID: (uid: string | null) => void;
  setCurrentFrame: (frame: number) => void;
  setActiveSrId?: (id: string | null) => void;

  safeRenderViewport: (vpId?: string) => void;

  selectedMeasurementUIDRef?: React.RefObject<string | null>;
};

export default function useMeasurementSelector(opts: UseMeasurementSelectorOpts) {
  const {
    renderingEngineRef,
    viewportInstance,
    viewportEl,
    viewportId = VIEWPORT_ID,
    mergedSeriesMapRef,
    allMeasurements,
    selectedSeries,
    pendingSeriesNavigationRef,
    setSelectedSeries,
    setSelectedMeasurementUID,
    setCurrentFrame,
    setActiveSrId,
    safeRenderViewport,
    selectedMeasurementUIDRef,
  } = opts;

  const selectFlowCounterRef = useRef(0);
  const selectingRef = useRef(false);
  const lastSelectingUIDRef = useRef<string | null>(null);

  /**
   * Navigates to a measurement and selects it. The paths below are tried in
   * order; each either finishes the request or falls through to the next:
   *
   * 1. The pane the measurement was drawn in, if it is not the primary pane
   *    and shows the measurement's series (split layouts open one series in
   *    several panes, so the image alone cannot tell which pane it was).
   * 2. The stack the primary pane shows: change its image (or keep it, when
   *    it is already shown).
   * 3. Another stack: select its series; useRenderingEngine opens it at the
   *    pending navigation's image. This hook never sets a stack.
   *
   * A measurement whose series has no images is left alone, as there is no
   * image to show it on. (The panel lists only measurements of a shown series
   * or of an SR made over one, so it offers no such card.)
   * Only the latest request continues after an await, and nothing is
   * selected for a measurement that is being removed.
   */
  const handleSelectMeasurement = useCallback(async (m: any) => {
    const annotationUID = String(m?.annotationUID ?? '');
    if (!annotationUID || isAnnotationRemovalTombstoned(annotationUID)) return;

    cancelActiveAnnotationInteraction(viewportEl);

    // Guard: avoid re-entrant selection for same uid
    if (selectingRef.current && lastSelectingUIDRef.current === (m?.annotationUID ?? null)) {
      return;
    }
    selectingRef.current = true;
    lastSelectingUIDRef.current = m?.annotationUID ?? null;

    try {
      const requestId = ++selectFlowCounterRef.current;
      const isCurrentRequest = () =>
        requestId === selectFlowCounterRef.current;
      const isStale = () =>
        !isCurrentRequest() || isAnnotationRemovalTombstoned(annotationUID);

      const targetSeriesUID = String(m.metadata?.seriesUID ?? '');
      const reportSeriesUID = String(m.metadata?.reportSeriesUID ?? '');
      if (!targetSeriesUID) return;

      const imageIds: string[] =
        mergedSeriesMapRef.current?.[targetSeriesUID]?.files ?? [];
      if (imageIds.length === 0) return;
      const liveAnnotation =
        (csAnnotation.state as any)?.getAnnotation?.(annotationUID) ?? null;

      // Registers the annotation on `element`: `known`, else the one in
      // Cornerstone's state, else the one that appears within waitMs.
      // Resolves with whether it is registered, or null once a newer
      // request took over.
      const attachAnnotation = async (
        element: HTMLDivElement | null | undefined,
        waitMs: number,
        known: any = null
      ): Promise<boolean | null> => {
        const instance =
          known ??
          (await ensureAnnotationAvailable(annotationUID, waitMs).catch(
            () => null
          ));
        if (!isCurrentRequest()) return null;
        if (!instance || !element) return false;
        let attached = false;
        try {
          attached = await safeAddAnnotation(instance, element);
        } catch {}
        return isCurrentRequest() ? attached : null;
      };
      const showTargetSeriesAndReport = () => {
        if (selectedSeries !== targetSeriesUID) setSelectedSeries(targetSeriesUID);
        try {
          setActiveSrId?.(reportSeriesUID || null);
        } catch {}
      };
      const commitSelection = () =>
        setSelectedMeasurementUIDIfChanged(
          setSelectedMeasurementUID,
          selectedMeasurementUIDRef,
          annotationUID
        );
      const clearPendingNavigation = (imageIndex: number) => {
        const pending = pendingSeriesNavigationRef.current;
        if (
          pending?.seriesUID === targetSeriesUID &&
          pending.imageIndex === imageIndex
        ) {
          pendingSeriesNavigationRef.current = null;
        }
      };

      // 1. The pane the measurement was drawn in.
      const selectInRecordedPane = async (): Promise<boolean> => {
        const recordedViewportId = String(m.metadata?.viewportId ?? viewportId);
        if (recordedViewportId === viewportId) return false;
        try {
          const recordedViewport =
            renderingEngineRef?.current?.getViewport?.(recordedViewportId);
          const recordedImageIds = recordedViewport?.getImageIds?.() ?? [];
          if (
            !recordedViewport ||
            !Array.isArray(recordedImageIds) ||
            !areImageStacksEqual(recordedImageIds, imageIds)
          ) {
            return false;
          }
          const desiredIndex = resolveMeasurementImageIndex(
            m,
            imageIds,
            liveAnnotation
          );
          const element = recordedViewport.element as HTMLDivElement | undefined;
          cancelActiveAnnotationInteraction(element ?? null);

          if (
            recordedViewport.getCurrentImageIdIndex?.() !== desiredIndex &&
            typeof recordedViewport.setImageIdIndex === 'function'
          ) {
            await recordedViewport.setImageIdIndex(desiredIndex);
            if (!isCurrentRequest()) return true;
          }

          const attached = await attachAnnotation(element, 800, liveAnnotation);
          if (attached === null) return true;
          if (!attached || !element) return false;
          if (isStale()) return true;
          selectCornerstoneAnnotation(annotationUID);
          setActiveSrId?.(reportSeriesUID || null);
          commitSelection();
          try {
            csToolsUtilities.triggerAnnotationRender(element);
          } catch {}
          safeRenderViewport(recordedViewportId);
          return true;
        } catch {
          // The primary-pane paths below recover if the recorded pane no
          // longer shows this series.
          return false;
        }
      };

      // 2. The stack the primary pane shows. setImageIdIndex is Cornerstone's
      // awaitable API and keeps the camera, VOI, rotation and flip.
      const selectInCurrentStack = async (desiredIndex: number): Promise<boolean> => {
        try {
          const activeViewport =
            renderingEngineRef?.current?.getViewport?.(viewportId) ?? viewportInstance;
          const activeImageIds = activeViewport?.getImageIds?.() ?? [];
          const isCurrentStack =
            Array.isArray(activeImageIds) &&
            activeImageIds.length > 0 &&
            areImageStacksEqual(activeImageIds, imageIds);
          if (!isCurrentStack || typeof activeViewport?.setImageIdIndex !== 'function') {
            return false;
          }

          if (activeViewport.getCurrentImageIdIndex?.() !== desiredIndex) {
            await activeViewport.setImageIdIndex(desiredIndex);
            if (!isCurrentRequest()) return true;
          }
          // setImageIdIndex sets the current index before it loads the
          // image, so it already holds unless another navigation took over;
          // waiting (formerly up to 8 x 25 ms) cannot bring it back.
          const confirmedIndex = activeViewport.getCurrentImageIdIndex?.();
          if (isStale()) return true;
          if (confirmedIndex !== desiredIndex) return false;

          const attached = await attachAnnotation(
            (activeViewport.element as HTMLDivElement | undefined) ?? viewportEl,
            800,
            liveAnnotation
          );
          if (attached === null) return true;
          if (attached) selectCornerstoneAnnotation(annotationUID);
          if (isStale()) return true;
          showTargetSeriesAndReport();
          commitSelection();
          if (isStale()) return true;
          clearPendingNavigation(desiredIndex);
          setCurrentFrame(desiredIndex + 1);
          safeRenderViewport(viewportId);
          return true;
        } catch {
          return false;
        }
      };

      // 3. Another stack.
      const selectAcrossStacks = async (desiredIndex: number) => {
        if (isStale()) return;
        showTargetSeriesAndReport();

        let attached: boolean | null = false;
        try {
          attached = await attachAnnotation(viewportEl, 1500);
          if (attached === null) return;
          if (attached) selectCornerstoneAnnotation(annotationUID);
        } catch {}

        if (isStale()) return;
        if (attached) {
          commitSelection();
          if (!isCurrentRequest()) return;
        }
        if (isAnnotationRemovalTombstoned(annotationUID)) return;
        setCurrentFrame(desiredIndex + 1);
        safeRenderViewport(viewportId);
      };

      if (await selectInRecordedPane()) return;

      const desiredIndex = resolveMeasurementImageIndex(m, imageIds, liveAnnotation);
      pendingSeriesNavigationRef.current = {
        seriesUID: targetSeriesUID,
        imageIndex: desiredIndex,
      };
      if (await selectInCurrentStack(desiredIndex)) return;
      await selectAcrossStacks(desiredIndex);
    } finally {
      selectingRef.current = false;
      lastSelectingUIDRef.current = null;
    }
  }, [
    mergedSeriesMapRef,
    viewportInstance,
    viewportEl,
    renderingEngineRef,
    selectedSeries,
    pendingSeriesNavigationRef,
    setSelectedSeries,
    setCurrentFrame,
    setSelectedMeasurementUID,
    setActiveSrId,
    safeRenderViewport,
    viewportId,
    selectedMeasurementUIDRef,
  ]);

  const handleSelectSr = useCallback(async (srId: string | null) => {
    ++selectFlowCounterRef.current;
    if (!srId) {
      pendingSeriesNavigationRef.current = null;
      try { setActiveSrId?.(null); } catch {}

      const selectedUID = selectedMeasurementUIDRef?.current;
      const selectedMeasurement = allMeasurements.find(
        (measurement) => measurement.annotationUID === selectedUID
      );
      if (selectedMeasurement?.metadata?.reportSeriesUID) {
        setSelectedMeasurementUID(null);
      }

      safeRenderViewport(viewportId);
      return;
    }

    const first = allMeasurements.find(
      (measurement) =>
        measurement.metadata?.reportSeriesUID === srId
    );
    if (!first) return;

    try { setActiveSrId?.(srId); } catch {}
    await handleSelectMeasurement(first);
  }, [
    allMeasurements,
    handleSelectMeasurement,
    pendingSeriesNavigationRef,
    setSelectedMeasurementUID,
    setActiveSrId,
    safeRenderViewport,
    viewportId,
    selectedMeasurementUIDRef,
  ]);

  return {
    handleSelectMeasurement,
    handleSelectSr,
  };
}

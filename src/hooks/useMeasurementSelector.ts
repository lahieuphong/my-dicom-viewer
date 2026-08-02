// src/hooks/useMeasurementSelector.ts
'use client';

import React from 'react';
import { useCallback, useRef } from 'react';
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import {
  areImageStacksEqual,
  findMatchingImageIdIndex,
} from '@/lib/cornerstone/helpers';
import { ensureAnnotationAvailable } from '@/lib/cornerstone/annotations';
import { VIEWPORT_ID } from '@/constants/viewport';
import {
  isAnnotationRemovalTombstoned,
  safeAddAnnotation,
} from '@/lib/viewer/annotationHelpers';
import { selectMeasurementAnnotation } from '@/lib/cornerstone/measurementStyles';
import type { AnnotationMeasurement } from '@/hooks/useMeasurements';

function resolveMeasurementImageIndex(
  measurement: AnnotationMeasurement,
  imageIds: string[],
  annotationInstance?: any
): number {
  const referenceCandidates = [
    annotationInstance?.metadata?.referencedImageId,
    annotationInstance?.metadata?.imageId,
    measurement?.metadata?.referencedImageId,
    measurement?.metadata?.imageId,
    measurement?.data?.referencedImageId,
    measurement?.data?.imageId,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  const storedIndex = Number(measurement?.metadata?.frameIndex);
  const validStoredIndex =
    Number.isInteger(storedIndex) && storedIndex >= 0
      ? storedIndex
      : undefined;

  for (const reference of referenceCandidates) {
    const matchedIndex = findMatchingImageIdIndex(
      imageIds,
      reference,
      validStoredIndex
    );
    if (matchedIndex >= 0) return matchedIndex;
  }

  if (typeof validStoredIndex === 'number') {
    return Math.min(storedIndex, Math.max(0, imageIds.length - 1));
  }

  return 0;
}

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

  const isViewportShowingDesiredImage = useCallback((imageIds: string[], desiredIndex: number) => {
    try {
      if (!viewportInstance || !Array.isArray(imageIds) || imageIds.length === 0) return false;

      if (!viewportInstance.getImageIds) return false;
      const vpIds: string[] = viewportInstance.getImageIds() ?? [];
      if (
        !Array.isArray(vpIds) ||
        vpIds.length === 0 ||
        !areImageStacksEqual(vpIds, imageIds)
      ) {
        return false;
      }

      const indexGetter =
        (viewportInstance as any).getCurrentImageIdIndex ??
        (viewportInstance as any).getImageIdIndex;
      if (typeof indexGetter !== 'function') return false;

      const currentIndex = indexGetter.call(viewportInstance);
      return currentIndex === desiredIndex;
    } catch (error) {
      return false;
    }
  }, [viewportInstance]);

  const handleSelectMeasurement = useCallback(async (m: any) => {
    const annotationUID = String(m?.annotationUID ?? '');
    if (!annotationUID || isAnnotationRemovalTombstoned(annotationUID)) return;

    // Guard: avoid re-entrant selection for same uid
    if (selectingRef.current && lastSelectingUIDRef.current === (m?.annotationUID ?? null)) {
      return;
    }
    selectingRef.current = true;
    lastSelectingUIDRef.current = m?.annotationUID ?? null;

    let selectionConfirmed = false;
    try {
      const requestId = ++selectFlowCounterRef.current;
      const isCurrentRequest = () =>
        requestId === selectFlowCounterRef.current;

      const targetSeriesUID = String(m.metadata?.seriesUID ?? '');
      const reportSeriesUID = String(
        m.metadata?.reportSeriesUID ?? ''
      );
      if (!targetSeriesUID) {
        return;
      }

      const imageIds = mergedSeriesMapRef.current?.[targetSeriesUID]?.files ?? [];
      const liveAnnotation =
        (csAnnotation.state as any)?.getAnnotation?.(m.annotationUID) ?? null;

      if (!Array.isArray(imageIds) || imageIds.length === 0) {
        const desiredIndex = Math.max(
          0,
          Number.isInteger(Number(m.metadata?.frameIndex))
            ? Number(m.metadata.frameIndex)
            : 0
        );
        pendingSeriesNavigationRef.current = {
          seriesUID: targetSeriesUID,
          imageIndex: desiredIndex,
        };
        if (selectedSeries !== targetSeriesUID) {
          setSelectedSeries(targetSeriesUID);
        }
        try {
          setActiveSrId?.(reportSeriesUID || null);
        } catch {}

        try {
          if (viewportEl) {
            const inst = (csAnnotation.state as any)?.getAnnotation?.(m.annotationUID) ?? null;
            if (inst) {
              const attached = await safeAddAnnotation(inst, viewportEl);
              if (!isCurrentRequest()) return;
              if (attached) {
                selectCornerstoneAnnotation(m.annotationUID);
                selectionConfirmed = true;
              }
            } else {
              const maybe = await ensureAnnotationAvailable(m.annotationUID, 1500, 50).catch(() => null);
              if (!isCurrentRequest()) return;
              if (maybe) {
                const attached = await safeAddAnnotation(maybe, viewportEl);
                if (!isCurrentRequest()) return;
                if (attached) {
                  selectCornerstoneAnnotation(m.annotationUID);
                  selectionConfirmed = true;
                }
              } else {
              }
            }
          }
        } catch (error) {
        }

        if (
          !isCurrentRequest() ||
          isAnnotationRemovalTombstoned(annotationUID)
        ) {
          return;
        }
        if (selectionConfirmed) {
          setSelectedMeasurementUIDIfChanged(
            setSelectedMeasurementUID,
            selectedMeasurementUIDRef,
            m.annotationUID,
          );
          if (
            !isCurrentRequest() ||
            isAnnotationRemovalTombstoned(annotationUID)
          ) {
            return;
          }
          setCurrentFrame(desiredIndex + 1);
        } else {
          setCurrentFrame(desiredIndex + 1);
        }

        safeRenderViewport(viewportId);
        return;
      }

      const desiredIndex = resolveMeasurementImageIndex(m, imageIds, liveAnnotation);
      pendingSeriesNavigationRef.current = {
        seriesUID: targetSeriesUID,
        imageIndex: desiredIndex,
      };

      // A measurement click within the current stack is an index navigation,
      // not a stack re-attachment. setImageIdIndex is Cornerstone's public,
      // awaitable API and preserves the current camera, VOI, rotation and flip.
      try {
        const activeViewport =
          renderingEngineRef?.current?.getViewport?.(viewportId) ?? viewportInstance;
        const activeImageIds = activeViewport?.getImageIds?.() ?? [];
        const isCurrentStack =
          Array.isArray(activeImageIds) &&
          activeImageIds.length > 0 &&
          areImageStacksEqual(activeImageIds, imageIds);

        if (isCurrentStack && typeof activeViewport?.setImageIdIndex === 'function') {
          const currentIndex = activeViewport.getCurrentImageIdIndex?.();
          if (currentIndex !== desiredIndex) {
            await activeViewport.setImageIdIndex(desiredIndex);
            if (!isCurrentRequest()) return;
          }

          let confirmedIndex = activeViewport.getCurrentImageIdIndex?.();
          for (
            let attempt = 0;
            confirmedIndex !== desiredIndex && attempt < 8;
            attempt += 1
          ) {
            await new Promise((resolve) => setTimeout(resolve, 25));
            if (!isCurrentRequest()) return;
            confirmedIndex = activeViewport.getCurrentImageIdIndex?.();
          }

          if (
            !isCurrentRequest() ||
            isAnnotationRemovalTombstoned(annotationUID)
          ) {
            return;
          }
          if (confirmedIndex === desiredIndex) {
            const annotation =
              liveAnnotation ??
              (await ensureAnnotationAvailable(m.annotationUID, 800, 40).catch(
                () => null
              ));
            if (!isCurrentRequest()) return;
            const targetElement =
              (activeViewport.element as HTMLDivElement | undefined) ?? viewportEl;

            if (annotation && targetElement) {
              try {
                selectionConfirmed = await safeAddAnnotation(
                  annotation,
                  targetElement
                );
                if (!isCurrentRequest()) return;
              } catch {
                selectionConfirmed = false;
              }
            }

            if (selectionConfirmed) {
              selectCornerstoneAnnotation(m.annotationUID);
            }
            if (
              !isCurrentRequest() ||
              isAnnotationRemovalTombstoned(annotationUID)
            ) {
              return;
            }
            if (selectedSeries !== targetSeriesUID) {
              setSelectedSeries(targetSeriesUID);
            }
            try {
              setActiveSrId?.(reportSeriesUID || null);
            } catch {}

            setSelectedMeasurementUIDIfChanged(
              setSelectedMeasurementUID,
              selectedMeasurementUIDRef,
              m.annotationUID,
            );
            if (
              !isCurrentRequest() ||
              isAnnotationRemovalTombstoned(annotationUID)
            ) {
              return;
            }
            const pendingNavigation = pendingSeriesNavigationRef.current;
            if (
              pendingNavigation?.seriesUID === targetSeriesUID &&
              pendingNavigation.imageIndex === desiredIndex
            ) {
              pendingSeriesNavigationRef.current = null;
            }
            setCurrentFrame(desiredIndex + 1);
            safeRenderViewport(viewportId);
            return;
          }
        }
      } catch {
        // Fall through to the cross-stack recovery path below.
      }

      try {
        if (isViewportShowingDesiredImage(imageIds, desiredIndex)) {
          if (!isCurrentRequest()) return;
          if (selectedSeries !== targetSeriesUID) setSelectedSeries(targetSeriesUID);
          try {
            setActiveSrId?.(reportSeriesUID || null);
          } catch {}

          const inst = (csAnnotation.state as any)?.getAnnotation?.(m.annotationUID) ?? null;
          if (inst) {
            try {
              selectionConfirmed = await safeAddAnnotation(inst, viewportEl);
              if (!isCurrentRequest()) return;
            } catch {}
            if (selectionConfirmed) {
              selectCornerstoneAnnotation(m.annotationUID);
            }
          } else {
            const maybe = await ensureAnnotationAvailable(m.annotationUID, 600, 30).catch(() => null);
            if (!isCurrentRequest()) return;
            if (maybe) {
              try {
                selectionConfirmed = await safeAddAnnotation(maybe, viewportEl);
                if (!isCurrentRequest()) return;
              } catch {}
              if (selectionConfirmed) {
                selectCornerstoneAnnotation(m.annotationUID);
              }
            } else {
              selectionConfirmed = false;
            }
          }

          if (
            !isCurrentRequest() ||
            isAnnotationRemovalTombstoned(annotationUID)
          ) {
            return;
          }
          if (selectionConfirmed) {
            setSelectedMeasurementUIDIfChanged(
              setSelectedMeasurementUID,
              selectedMeasurementUIDRef,
              m.annotationUID
            );
            if (!isCurrentRequest()) return;
          }
          if (isAnnotationRemovalTombstoned(annotationUID)) return;
          const pendingNavigation = pendingSeriesNavigationRef.current;
          if (
            pendingNavigation?.seriesUID === targetSeriesUID &&
            pendingNavigation.imageIndex === desiredIndex
          ) {
            pendingSeriesNavigationRef.current = null;
          }
          setCurrentFrame((desiredIndex ?? 0) + 1);

          safeRenderViewport(viewportId);
          return;
        } else {
        }
      } catch (error) {
      }

      if (
        !isCurrentRequest() ||
        isAnnotationRemovalTombstoned(annotationUID)
      ) {
        return;
      }

      // Cross-stack navigation is owned by the selected-series attach effect.
      // Register/select the annotation here, but never mutate the stack from
      // this hook; pendingSeriesNavigationRef carries the requested frame.
      if (selectedSeries !== targetSeriesUID) {
        setSelectedSeries(targetSeriesUID);
      }
      try { setActiveSrId?.(reportSeriesUID || null); } catch {}

      try {
        const inst =
          (csAnnotation.state as any)?.getAnnotation?.(m.annotationUID) ??
          (await ensureAnnotationAvailable(m.annotationUID, 1500, 50).catch(
            () => null
          ));
        if (!isCurrentRequest()) return;
        if (inst) {
          selectionConfirmed = await safeAddAnnotation(inst, viewportEl);
          if (!isCurrentRequest()) return;
        }
        if (selectionConfirmed) {
          selectCornerstoneAnnotation(m.annotationUID);
        }
      } catch {}

      if (
        !isCurrentRequest() ||
        isAnnotationRemovalTombstoned(annotationUID)
      ) {
        return;
      }

      if (selectionConfirmed) {
        setSelectedMeasurementUIDIfChanged(
          setSelectedMeasurementUID,
          selectedMeasurementUIDRef,
          m.annotationUID
        );
        if (!isCurrentRequest()) return;
      }

      if (isAnnotationRemovalTombstoned(annotationUID)) return;
      setCurrentFrame((desiredIndex ?? 0) + 1);

      safeRenderViewport(viewportId);
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
    isViewportShowingDesiredImage,
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

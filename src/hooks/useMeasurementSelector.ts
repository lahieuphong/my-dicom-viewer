// src/hooks/useMeasurementSelector.ts
'use client';

import React from 'react';
import { useCallback, useRef } from 'react';
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import {
  findMatchingImageIdIndex,
  normalizeImageIdWithFrame,
} from '@/lib/cornerstone/helpers';
import { preloadImagesWithTimeout } from '@/lib/viewer/preload';
import { ensureAnnotationAvailable } from '@/lib/cornerstone/annotations';
import { VIEWPORT_ID } from '@/constants/viewport';
import {
  isAnnotationRemovalTombstoned,
  safeAddAnnotation,
  safeGetAnnotations,
} from '@/lib/viewer/annotationHelpers';
import { selectMeasurementAnnotation } from '@/lib/cornerstone/measurementStyles';

// import chung constants để thống nhất attempts/timeouts
import { ATTEMPTS_ANNOT } from '@/lib/viewer/constants';

function imageStacksMatch(first: string[], second: string[]): boolean {
  return (
    first.length === second.length &&
    first.every(
      (imageId, index) =>
        normalizeImageIdWithFrame(imageId) ===
        normalizeImageIdWithFrame(second[index])
    )
  );
}

function resolveMeasurementImageIndex(
  measurement: any,
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

  mergedSeriesMapRef: React.RefObject<Record<string, { files: string[]; metadata?: any }>>;
  allMeasurements: any[]; // AnnotationMeasurement[]
  selectedSeries: string;
  prevSeriesRef: React.RefObject<string | null>;
  pendingSeriesNavigationRef: React.MutableRefObject<{
    seriesUID: string;
    imageIndex: number;
  } | null>;

  setSelectedSeries: React.Dispatch<React.SetStateAction<string>>;
  setSelectedMeasurementUID: (uid: string | null) => void;
  setCurrentFrame: (frame: number) => void;
  setActiveSrId?: (id: string | null) => void;

  safeRenderViewport: (vpId?: string) => void;
  ensureImageRendered?: any;
  preloadImagesWithTimeout?: typeof preloadImagesWithTimeout;

  selectionInProgressRef?: React.MutableRefObject<boolean>;
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
    prevSeriesRef,
    pendingSeriesNavigationRef,
    setSelectedSeries,
    setSelectedMeasurementUID,
    setCurrentFrame,
    setActiveSrId,
    safeRenderViewport,
    selectionInProgressRef,
    selectedMeasurementUIDRef,
  } = opts;

  const selectFlowCounterRef = useRef(0);
  const selectingRef = useRef(false);
  const lastSelectingUIDRef = useRef<string | null>(null);
  const isSrSeriesUID = useCallback(
    (seriesUID?: string | null) => {
      if (!seriesUID) return false;
      return (
        mergedSeriesMapRef.current?.[seriesUID]?.metadata
          ?.seriesModality === 'SR' ||
        String(seriesUID).startsWith('SR_')
      );
    },
    [mergedSeriesMapRef]
  );

  const rememberSourceSeriesBeforeSr = useCallback(
    (targetSeriesUID?: string | null) => {
      if (
        isSrSeriesUID(targetSeriesUID) &&
        selectedSeries &&
        !isSrSeriesUID(selectedSeries)
      ) {
        prevSeriesRef.current = selectedSeries;
      }
    },
    [isSrSeriesUID, prevSeriesRef, selectedSeries]
  );

  const isViewportShowingDesiredImage = useCallback((imageIds: string[], desiredIndex: number) => {
    try {
      if (!viewportInstance || !Array.isArray(imageIds) || imageIds.length === 0) return false;

      if (!viewportInstance.getImageIds) return false;
      const vpIds: string[] = viewportInstance.getImageIds() ?? [];
      if (
        !Array.isArray(vpIds) ||
        vpIds.length === 0 ||
        !imageStacksMatch(vpIds, imageIds)
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

  // NEW helper: set selectedMeasurementUID only when selection "confirmed" or after retries.
  const maybeSetSelectedMeasurementUID = useCallback(
    async function maybeSetSelectedMeasurementUID(
      uid: string | null,
      imageIds?: string[],
      desiredIndex?: number,
      maxAttempts = ATTEMPTS_ANNOT,
      attemptDelayMs = 80
    ) {
      try {
        if (!uid) {
          setSelectedMeasurementUIDIfChanged(
            setSelectedMeasurementUID,
            selectedMeasurementUIDRef,
            null
          );
          return;
        }

        const prev = selectedMeasurementUIDRef && selectedMeasurementUIDRef.current ? selectedMeasurementUIDRef.current : null;
        if (prev === uid) {
          return;
        }

        for (let i = 0; i < maxAttempts; i += 1) {
          try {
            if (typeof isViewportShowingDesiredImage === 'function' && Array.isArray(imageIds) && typeof desiredIndex === 'number') {
              try {
                const ok = isViewportShowingDesiredImage(imageIds, desiredIndex);
                if (ok) {
                  setSelectedMeasurementUIDIfChanged(
                    setSelectedMeasurementUID,
                    selectedMeasurementUIDRef,
                    uid
                  );
                  return;
                }
              } catch (e) {
              }
            }
          } catch {}

          try {
            const anns = safeGetAnnotations(undefined, viewportEl);
            if (Array.isArray(anns) && anns.some((a) => a?.annotationUID === uid)) {
              setSelectedMeasurementUIDIfChanged(
                setSelectedMeasurementUID,
                selectedMeasurementUIDRef,
                uid
              );
              return;
            }

            try {
              const inst = (csAnnotation.state as any)?.getAnnotation?.(uid) ?? null;
              if (inst) {
                setSelectedMeasurementUIDIfChanged(
                  setSelectedMeasurementUID,
                  selectedMeasurementUIDRef,
                  uid
                );
                return;
              }
            } catch (e) {
            }
          } catch {}

          await new Promise((r) => setTimeout(r, attemptDelayMs));
        }
        setSelectedMeasurementUIDIfChanged(
          setSelectedMeasurementUID,
          selectedMeasurementUIDRef,
          uid
        );
      } catch (e) {
        setSelectedMeasurementUIDIfChanged(
          setSelectedMeasurementUID,
          selectedMeasurementUIDRef,
          uid
        );
      }
    },
    [
      isViewportShowingDesiredImage,
      viewportEl,
      selectedMeasurementUIDRef,
      setSelectedMeasurementUID,
    ]
  );

  const handleSelectMeasurement = useCallback(async (m: any) => {
    const annotationUID = String(m?.annotationUID ?? '');
    if (!annotationUID || isAnnotationRemovalTombstoned(annotationUID)) return;

    // Guard: avoid re-entrant selection for same uid
    if (selectingRef.current && lastSelectingUIDRef.current === (m?.annotationUID ?? null)) {
      return;
    }
    selectingRef.current = true;
    lastSelectingUIDRef.current = m?.annotationUID ?? null;
    if (selectionInProgressRef && typeof selectionInProgressRef === 'object' && 'current' in selectionInProgressRef) {
      try { (selectionInProgressRef as any).current = true; } catch {}
    }

    let selectionConfirmed = false;
    try {
      const requestId = ++selectFlowCounterRef.current;
      const isCurrentRequest = () =>
        requestId === selectFlowCounterRef.current;

      const targetSeriesUID = String(m.metadata?.seriesUID ?? '');
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
        rememberSourceSeriesBeforeSr(targetSeriesUID);
        if (selectedSeries !== targetSeriesUID) {
          setSelectedSeries(targetSeriesUID);
        }
        try {
          setActiveSrId?.(
            isSrSeriesUID(targetSeriesUID) ? targetSeriesUID : null
          );
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
          await maybeSetSelectedMeasurementUID(
            m.annotationUID,
            imageIds,
            desiredIndex
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
          imageStacksMatch(activeImageIds, imageIds);

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
            rememberSourceSeriesBeforeSr(targetSeriesUID);
            if (selectedSeries !== targetSeriesUID) {
              setSelectedSeries(targetSeriesUID);
            }
            try {
              setActiveSrId?.(
                isSrSeriesUID(targetSeriesUID) ? targetSeriesUID : null
              );
            } catch {}

            await maybeSetSelectedMeasurementUID(
              m.annotationUID,
              imageIds,
              desiredIndex
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
          rememberSourceSeriesBeforeSr(targetSeriesUID);
          if (selectedSeries !== targetSeriesUID) setSelectedSeries(targetSeriesUID);
          try {
            setActiveSrId?.(
              isSrSeriesUID(targetSeriesUID) ? targetSeriesUID : null
            );
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
            await maybeSetSelectedMeasurementUID(m.annotationUID, imageIds, desiredIndex);
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
      rememberSourceSeriesBeforeSr(targetSeriesUID);
      if (selectedSeries !== targetSeriesUID) {
        setSelectedSeries(targetSeriesUID);
      }
      if (isSrSeriesUID(targetSeriesUID)) {
        try { setActiveSrId?.(targetSeriesUID); } catch {}
      } else {
        try { setActiveSrId?.(null); } catch {}
      }

      try {
        const anns = safeGetAnnotations(m.toolName, viewportEl);
        const found = Array.isArray(anns) ? anns.find((a) => a.annotationUID === m.annotationUID) : undefined;
        if (!found) {
          const inst = (csAnnotation.state as any)?.getAnnotation?.(m.annotationUID) ?? null;
          const maybe = inst ?? (await ensureAnnotationAvailable(m.annotationUID, 1500, 50).catch(() => null));
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
        } else {
          selectCornerstoneAnnotation(m.annotationUID);
          selectionConfirmed = true;
        }
      } catch {}

      if (
        !isCurrentRequest() ||
        isAnnotationRemovalTombstoned(annotationUID)
      ) {
        return;
      }

      if (selectionConfirmed) {
        await maybeSetSelectedMeasurementUID(m.annotationUID, imageIds, desiredIndex);
        if (!isCurrentRequest()) return;
      } else {
      }

      if (isAnnotationRemovalTombstoned(annotationUID)) return;
      setCurrentFrame((desiredIndex ?? 0) + 1);

      safeRenderViewport(viewportId);
    } finally {
      try {
        if (selectionInProgressRef && typeof selectionInProgressRef === 'object' && 'current' in selectionInProgressRef) {
          try { (selectionInProgressRef as any).current = false; } catch {}
        }
      } catch {}
      selectingRef.current = false;
      lastSelectingUIDRef.current = null;
    }
  }, [
    mergedSeriesMapRef,
    viewportInstance,
    viewportEl,
    renderingEngineRef,
    selectedSeries,
    prevSeriesRef,
    pendingSeriesNavigationRef,
    setSelectedSeries,
    setCurrentFrame,
    setSelectedMeasurementUID,
    setActiveSrId,
    safeRenderViewport,
    viewportId,
    isViewportShowingDesiredImage,
    selectionInProgressRef,
    selectedMeasurementUIDRef,
    maybeSetSelectedMeasurementUID,
    isSrSeriesUID,
    rememberSourceSeriesBeforeSr,
  ]);


  const handleSelectSr = useCallback(async (srId: string | null) => {
    const requestId = ++selectFlowCounterRef.current;
    if (srId) {
      if (!isSrSeriesUID(srId)) return;
      rememberSourceSeriesBeforeSr(srId);
      const srMeasurements = allMeasurements.filter((m) => String(m.metadata?.seriesUID) === String(srId));
      const first = srMeasurements[0];
      const imageIds = mergedSeriesMapRef.current?.[srId]?.files ?? [];
      let firstAnnotation: any = null;
      if (first) {
        try {
          firstAnnotation =
            (csAnnotation.state as any)?.getAnnotation?.(
              first.annotationUID
            ) ?? null;
        } catch {}
      }
      const desiredIndex = first
        ? resolveMeasurementImageIndex(first, imageIds, firstAnnotation)
        : 0;

      /**
       * selectedSeries is the single owner of stack navigation. Its viewer
       * effect already has a superseding request token, so View/Close/View
       * races cannot leave an older SR stack behind.
       */
      pendingSeriesNavigationRef.current = {
        seriesUID: srId,
        imageIndex: desiredIndex,
      };
      try { setActiveSrId?.(srId); } catch {}
      setSelectedSeries(srId);

      for (const m of srMeasurements) {
        if (requestId !== selectFlowCounterRef.current) return;
        try {
          let inst = null;
          try { inst = csAnnotation.state.getAnnotation?.(m.annotationUID); } catch {}
          if (!inst) {
            inst = await ensureAnnotationAvailable(m.annotationUID, 1500, 50).catch(() => null);
            if (requestId !== selectFlowCounterRef.current) return;
          }
          if (!inst) {
            const mm = allMeasurements.find((x) => x.annotationUID === m.annotationUID) as any;
            if (mm && mm.__rawInstance) inst = mm.__rawInstance;
          }
          if (inst) {
            try {
              await safeAddAnnotation(inst, viewportEl);
              if (requestId !== selectFlowCounterRef.current) return;
            } catch {}
          } else {
          }
        } catch {}
      }

      if (requestId !== selectFlowCounterRef.current) return;
      if (first) {
        setSelectedMeasurementUID(first.annotationUID);
        setCurrentFrame(desiredIndex + 1);
      }

      safeRenderViewport(viewportId);
    } else {
      try { setActiveSrId?.(null); } catch {}
      const previous = prevSeriesRef.current;
      const fallback =
        previous &&
        mergedSeriesMapRef.current?.[previous] &&
        !isSrSeriesUID(previous)
          ? previous
          : Object.keys(mergedSeriesMapRef.current || {}).find(
              (seriesUID) => !isSrSeriesUID(seriesUID)
            ) ?? '';
      if (fallback) {
        const fallbackImageIds =
          mergedSeriesMapRef.current?.[fallback]?.files ?? [];
        let runtimeIndex = 0;
        try {
          runtimeIndex = Number(
            viewportInstance?.getCurrentImageIdIndex?.() ?? 0
          );
        } catch {}
        const desiredIndex = Number.isInteger(runtimeIndex)
          ? Math.max(
              0,
              Math.min(runtimeIndex, Math.max(0, fallbackImageIds.length - 1))
            )
          : 0;
        pendingSeriesNavigationRef.current = {
          seriesUID: fallback,
          imageIndex: desiredIndex,
        };
        setCurrentFrame(desiredIndex + 1);
      } else {
        pendingSeriesNavigationRef.current = null;
      }
      setSelectedSeries(fallback);
    }
  }, [
    mergedSeriesMapRef,
    viewportInstance,
    viewportEl,
    prevSeriesRef,
    pendingSeriesNavigationRef,
    setSelectedSeries,
    setSelectedMeasurementUID,
    setCurrentFrame,
    setActiveSrId,
    safeRenderViewport,
    viewportId,
    allMeasurements,
    isSrSeriesUID,
    rememberSourceSeriesBeforeSr,
  ]);

  return {
    handleSelectMeasurement,
    handleSelectSr,
    isViewportShowingDesiredImage,
  };
}

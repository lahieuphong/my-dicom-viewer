'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Enums as CoreEnums,
  eventTarget,
  getEnabledElement,
  utilities as coreUtilities,
  type Types as CoreTypes,
} from '@cornerstonejs/core';
import {
  Enums as ToolEnums,
  annotation as cornerstoneAnnotation,
} from '@cornerstonejs/tools';

import {
  CalibrationLineTool,
  applyUserCalibration,
  calculateWorldDistance,
  getUserCalibrationOverride,
  isValidPhysicalLength,
  isUserCalibrationSupported,
  restoreUserCalibrationOverride,
} from '@/lib/cornerstone/calibration';

type PendingCalibration = {
  annotationUID: string;
  imageId: string;
  measuredLength: number;
  renderingEngine: CoreTypes.IRenderingEngine;
  element: HTMLDivElement;
};

type ReportStatsSnapshot = {
  annotationUID: string;
  cachedStats: any;
};

function cloneSerializable<T>(value: T): T | null {
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value)) as T;
    } catch {
      return null;
    }
  }
}

export type UseCalibrationLineOptions = {
  element: HTMLDivElement | null;
  stackKey?: string | number | null;
  enabled?: boolean;
};

export type UseCalibrationLineResult = {
  canCalibrate: boolean;
  defaultLength: number | null;
  error: string | null;
  isApplying: boolean;
  isOpen: boolean;
  applyCalibration: (actualLength: number) => Promise<boolean>;
  cancelCalibration: () => void;
};

function removeTemporaryAnnotation(
  annotationUID: string,
  element: HTMLDivElement | null
): void {
  if (!annotationUID) return;

  try {
    const annotation = cornerstoneAnnotation.state.getAnnotation(annotationUID);
    if (annotation?.metadata?.toolName === CalibrationLineTool.toolName) {
      cornerstoneAnnotation.state.removeAnnotation(annotationUID);
    }
  } catch {}

  try {
    if (element) getEnabledElement(element)?.viewport?.render?.();
  } catch {}
}

function createCalibrationEventWaiter(
  element: HTMLDivElement,
  imageId: string,
  reportStats: ReportStatsSnapshot[]
): { promise: Promise<boolean>; cancel: () => void } {
  let settled = false;
  let timeoutId = 0;
  let resolvePromise: (value: boolean) => void = () => {};

  const finish = (value: boolean) => {
    if (settled) return;
    settled = true;
    element.removeEventListener(
      CoreEnums.Events.IMAGE_SPACING_CALIBRATED,
      handleCalibrated as EventListener
    );
    window.clearTimeout(timeoutId);
    resolvePromise(value);
  };

  const handleCalibrated = (event: Event) => {
    const detail = (event as CustomEvent<{ imageId?: string }>).detail;
    if (detail?.imageId !== imageId) return;

    // Every AnnotationDisplayTool clears cachedStats for this image. Restore
    // immutable, hydrated SR annotations after all synchronous event handlers
    // finish but before the scheduled annotation render can recalculate them.
    queueMicrotask(() => {
      if (settled) return;
      for (const snapshot of reportStats) {
        try {
          const annotation = cornerstoneAnnotation.state.getAnnotation(
            snapshot.annotationUID
          );
          const metadata = annotation?.metadata as
            | Record<string, unknown>
            | undefined;
          const isReportAnnotation = Boolean(
            metadata?.reportSeriesUID ?? metadata?.reportSeriesInstanceUID
          );
          const referencedImageId = String(
            metadata?.referencedImageId ?? ''
          );
          const clonedStats = cloneSerializable(snapshot.cachedStats);
          if (
            !annotation?.data ||
            !isReportAnnotation ||
            !referencedImageId ||
            coreUtilities.imageIdToURI(referencedImageId) !==
              coreUtilities.imageIdToURI(imageId) ||
            !clonedStats
          ) {
            continue;
          }
          annotation.data.cachedStats = clonedStats;
          annotation.invalidated = false;
        } catch {}
      }
      finish(true);
    });
  };

  const promise = new Promise<boolean>((resolve) => {
    resolvePromise = resolve;
  });
  element.addEventListener(
    CoreEnums.Events.IMAGE_SPACING_CALIBRATED,
    handleCalibrated as EventListener
  );
  timeoutId = window.setTimeout(() => finish(false), 10_000);

  return { promise, cancel: () => finish(false) };
}

function snapshotImmutableReportStats(imageId: string): ReportStatsSnapshot[] {
  const imageURI = coreUtilities.imageIdToURI(imageId);
  const result: ReportStatsSnapshot[] = [];

  try {
    const annotations = cornerstoneAnnotation.state.getAllAnnotations?.() ?? [];
    for (const annotation of annotations as any[]) {
      const isReportAnnotation = Boolean(
        annotation?.metadata?.reportSeriesUID ??
          annotation?.metadata?.reportSeriesInstanceUID
      );
      const referencedImageId = String(
        annotation?.metadata?.referencedImageId ?? ''
      );
      if (
        !isReportAnnotation ||
        !referencedImageId ||
        coreUtilities.imageIdToURI(referencedImageId) !== imageURI
      ) {
        continue;
      }

      const cachedStats = annotation?.data?.cachedStats;
      if (!cachedStats || Object.keys(cachedStats).length === 0) continue;
      const clonedStats = cloneSerializable(cachedStats);
      if (!clonedStats) continue;
      result.push({
        annotationUID: String(annotation.annotationUID),
        cachedStats: clonedStats,
      });
    }
  } catch {}

  return result;
}

function createAnnotationStatsWaiter(
  element: HTMLDivElement
): { promise: Promise<void>; cancel: () => void } {
  let settled = false;
  let firstFrame = 0;
  let secondFrame = 0;
  let timeoutId = 0;
  let resolvePromise: () => void = () => {};

  const finish = () => {
    if (settled) return;
    settled = true;
    element.removeEventListener(
      ToolEnums.Events.ANNOTATION_RENDERED,
      handleRendered as EventListener
    );
    window.cancelAnimationFrame(firstFrame);
    window.cancelAnimationFrame(secondFrame);
    window.clearTimeout(timeoutId);
    resolvePromise();
  };
  const handleRendered = () => finish();

  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  element.addEventListener(
    ToolEnums.Events.ANNOTATION_RENDERED,
    handleRendered as EventListener
  );
  // If the image has no reportable annotations there is no rendered event.
  // Two frames let the scheduled pass settle; the timer also handles a
  // background tab where requestAnimationFrame is suspended.
  firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(finish);
  });
  timeoutId = window.setTimeout(finish, 1_000);

  return { promise, cancel: finish };
}

/** Owns the transient calibration annotation and its Save/Cancel lifecycle. */
export function useCalibrationLine({
  element,
  stackKey,
  enabled = true,
}: UseCalibrationLineOptions): UseCalibrationLineResult {
  const [pending, setPending] = useState<PendingCalibration | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<PendingCalibration | null>(null);
  const applyingRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);
  const activeWaiterRef = useRef<{ cancel: () => void } | null>(null);
  const statsWaiterRef = useRef<{ cancel: () => void } | null>(null);
  const calibrationSupported = isUserCalibrationSupported();

  const commitPending = useCallback((next: PendingCalibration | null) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const cancelCalibration = useCallback(() => {
    activeWaiterRef.current?.cancel();
    activeWaiterRef.current = null;
    statsWaiterRef.current?.cancel();
    statsWaiterRef.current = null;
    const current = pendingRef.current;
    if (current) {
      removeTemporaryAnnotation(current.annotationUID, current.element);
    }
    commitPending(null);
    applyingRef.current = false;
    setIsApplying(false);
    setError(null);
  }, [commitPending]);

  useEffect(() => {
    if (!element || !enabled || !calibrationSupported) return;

    const handleCompleted = (event: Event) => {
      const annotation = (event as CustomEvent<{ annotation?: any }>).detail
        ?.annotation;
      if (annotation?.metadata?.toolName !== CalibrationLineTool.toolName) {
        return;
      }

      const annotationUID = String(annotation.annotationUID ?? '');
      if (!annotationUID) return;
      const completionGeneration = lifecycleGenerationRef.current;

      // LengthTool emits COMPLETED before it clears editData. Deferring also
      // lets CalibrationLineTool.cancel() remove canceled drafts first.
      queueMicrotask(() => {
        if (
          completionGeneration !== lifecycleGenerationRef.current ||
          !enabled ||
          !calibrationSupported ||
          !element.isConnected
        ) {
          removeTemporaryAnnotation(annotationUID, element);
          return;
        }

        let liveAnnotation: any = null;
        try {
          liveAnnotation = cornerstoneAnnotation.state.getAnnotation(annotationUID);
          const viewportAnnotations =
            cornerstoneAnnotation.state.getAnnotations(
              CalibrationLineTool.toolName,
              element
            ) ?? [];
          if (
            !liveAnnotation ||
            !viewportAnnotations.some(
              (candidate: any) => candidate?.annotationUID === annotationUID
            )
          ) {
            return;
          }
        } catch {
          return;
        }

        const points = liveAnnotation?.data?.handles?.points as
          | CoreTypes.Point3[]
          | undefined;
        const imageId = String(
          liveAnnotation?.metadata?.referencedImageId ?? ''
        );
        const measuredLength =
          points && points.length >= 2
            ? Math.round(
                calculateWorldDistance(points[0], points[1]) * 100
              ) / 100
            : Number.NaN;

        let renderingEngine: CoreTypes.IRenderingEngine | null = null;
        try {
          renderingEngine =
            getEnabledElement(element)?.viewport?.getRenderingEngine?.() ?? null;
        } catch {}

        if (
          !imageId ||
          !renderingEngine ||
          !isValidPhysicalLength(measuredLength)
        ) {
          removeTemporaryAnnotation(annotationUID, element);
          return;
        }

        const previous = pendingRef.current;
        if (previous && previous.annotationUID !== annotationUID) {
          removeTemporaryAnnotation(previous.annotationUID, previous.element);
        }

        setError(null);
        applyingRef.current = false;
        setIsApplying(false);
        commitPending({
          annotationUID,
          imageId,
          measuredLength,
          renderingEngine,
          element,
        });
      });
    };

    eventTarget.addEventListener(
      ToolEnums.Events.ANNOTATION_COMPLETED,
      handleCompleted as EventListener
    );
    return () => {
      eventTarget.removeEventListener(
        ToolEnums.Events.ANNOTATION_COMPLETED,
        handleCompleted as EventListener
      );
    };
  }, [calibrationSupported, commitPending, element, enabled]);

  useEffect(() => {
    // A pending line must never target a viewport after its stack/read-only
    // state changes. Applied metadata remains intentionally image-scoped.
    lifecycleGenerationRef.current += 1;
    activeWaiterRef.current?.cancel();
    activeWaiterRef.current = null;
    statsWaiterRef.current?.cancel();
    statsWaiterRef.current = null;
    const current = pendingRef.current;
    if (current) removeTemporaryAnnotation(current.annotationUID, current.element);
    commitPending(null);
    applyingRef.current = false;
    setIsApplying(false);
    setError(null);

    return () => {
      lifecycleGenerationRef.current += 1;
      activeWaiterRef.current?.cancel();
      activeWaiterRef.current = null;
      statsWaiterRef.current?.cancel();
      statsWaiterRef.current = null;
      const latest = pendingRef.current;
      if (latest) {
        removeTemporaryAnnotation(latest.annotationUID, latest.element);
        pendingRef.current = null;
      }
      applyingRef.current = false;
    };
  }, [calibrationSupported, commitPending, element, enabled, stackKey]);

  const applyCalibration = useCallback(
    async (actualLength: number): Promise<boolean> => {
      const current = pendingRef.current;
      if (!current || applyingRef.current) return false;
      const applyGeneration = lifecycleGenerationRef.current;
      if (!isUserCalibrationSupported()) {
        setError('Hiệu chuẩn không được hỗ trợ ở chế độ dựng ảnh CPU.');
        return false;
      }
      if (!isValidPhysicalLength(actualLength)) {
        setError('Khoảng cách thực tế phải là một số lớn hơn 0.');
        return false;
      }

      setError(null);
      applyingRef.current = true;
      setIsApplying(true);
      const previousCalibration = getUserCalibrationOverride(current.imageId);
      const reportStats = snapshotImmutableReportStats(current.imageId);
      const waiter = createCalibrationEventWaiter(
        current.element,
        current.imageId,
        reportStats
      );
      activeWaiterRef.current = waiter;

      try {
        applyUserCalibration({
          imageId: current.imageId,
          measuredLength: current.measuredLength,
          actualLength,
          renderingEngine: current.renderingEngine,
        });
        removeTemporaryAnnotation(current.annotationUID, current.element);

        // Wait for StackViewport to reload the calibrated image so existing
        // measurements have a chance to invalidate/recalculate before close.
        const spacingRecalculated = await waiter.promise;
        if (activeWaiterRef.current === waiter) {
          activeWaiterRef.current = null;
        }
        if (!spacingRecalculated) {
          throw new Error('Calibration image did not finish reloading.');
        }
        const statsWaiter = createAnnotationStatsWaiter(current.element);
        statsWaiterRef.current = statsWaiter;
        await statsWaiter.promise;
        if (statsWaiterRef.current === statsWaiter) {
          statsWaiterRef.current = null;
        }

        if (
          applyGeneration !== lifecycleGenerationRef.current ||
          pendingRef.current !== current
        ) {
          return false;
        }

        if (pendingRef.current === current) {
          commitPending(null);
          applyingRef.current = false;
          setIsApplying(false);
        }
        return true;
      } catch {
        waiter.cancel();
        statsWaiterRef.current?.cancel();
        statsWaiterRef.current = null;
        restoreUserCalibrationOverride(
          current.imageId,
          previousCalibration
        );
        if (activeWaiterRef.current === waiter) {
          activeWaiterRef.current = null;
        }
        if (pendingRef.current === current) {
          applyingRef.current = false;
          setIsApplying(false);
          setError('Không thể áp dụng hiệu chuẩn cho ảnh hiện tại.');
        }
        return false;
      }
    },
    [commitPending]
  );

  return useMemo(
    () => ({
      canCalibrate: Boolean(
        calibrationSupported && enabled && element
      ),
      defaultLength: pending?.measuredLength ?? null,
      error,
      isApplying,
      isOpen: pending !== null,
      applyCalibration,
      cancelCalibration,
    }),
    [
      applyCalibration,
      cancelCalibration,
      calibrationSupported,
      element,
      enabled,
      error,
      isApplying,
      pending,
    ]
  );
}

// src/hooks/useMeasurements.ts
'use client';

import { useCallback, useEffect, useRef } from 'react';
import { eventTarget } from '@cornerstonejs/core';
import type { StackViewport } from '@cornerstonejs/core';
import {
  annotation,
  LengthTool,
  BidirectionalTool,
  RectangleROITool,
  ArrowAnnotateTool,
  EllipticalROITool,
  CircleROITool,
  PlanarFreehandROITool,
  SplineROITool,
  LivewireContourTool,
  AngleTool,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';
import { VIEWPORT_ID } from '@/constants/viewport';
import {
  findMatchingImageIdIndex,
  safeGetEnabledElement,
} from '@/lib/cornerstone/helpers';
import { isAnnotationCreationInProgress } from '@/lib/cornerstone/annotationInteraction';
import {
  createMeasurementListFingerprint,
} from '@/lib/viewer/measurementFingerprint';
import type { AnnotationMeasurement as CoreAnnotationMeasurement } from '@/platform/core';

/** Compatibility alias; the canonical measurement shape lives in platform/core. */
export type AnnotationMeasurement = CoreAnnotationMeasurement<any>;

function cloneMeasurementData<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

/**
 * Collect Cornerstone annotations, publish immutable measurement snapshots,
 * and expose refresh/updateLabel commands.
 *
 * Key fixes:
 * - Avoid using resolveSeriesUID directly as dependency by storing into ref.
 * - Calls onMeasurementsChange OUTSIDE of setState and defers it
 * - Avoids calling the external callback when nothing meaningful changed
 */
export const useMeasurements = ({
  element,
  onMeasurementsChange,
  seriesInstanceUID,
  studyInstanceUID,
  viewportId = VIEWPORT_ID,
  resolveSeriesUID,
}: {
  element: HTMLDivElement | null;
  onMeasurementsChange?: (measurements: AnnotationMeasurement[]) => void;
  seriesInstanceUID?: string;
  studyInstanceUID?: string;
  viewportId?: string;
  resolveSeriesUID?: (referencedImageId: string) => string | undefined;
}) => {
  const createdAtByAnnotationUIDRef = useRef<Map<string, string>>(
    new Map()
  );

  // keep latest callback in ref to avoid being a dependency for callbacks/effects
  const onMeasurementsChangeRef = useRef<typeof onMeasurementsChange | undefined>(onMeasurementsChange);
  useEffect(() => {
    onMeasurementsChangeRef.current = onMeasurementsChange;
  }, [onMeasurementsChange]);

  // keep a ref for last "sent key" to avoid re-sending identical data
  const lastSentMeasurementsKeyRef = useRef<string | null>(null);

  // Keep resolveSeriesUID in a ref to avoid re-creating collectAnnotations when caller passes non-memoized function
  const resolveSeriesUIDRef = useRef<typeof resolveSeriesUID | undefined>(resolveSeriesUID);
  useEffect(() => {
    resolveSeriesUIDRef.current = resolveSeriesUID;
  }, [resolveSeriesUID]);

  const collectAnnotations = useCallback((): AnnotationMeasurement[] => {
    if (!element) return [];
    const enabled = safeGetEnabledElement(element);
    if (!enabled) return [];

    const result: AnnotationMeasurement[] = [];

    const collect = (toolName: string, type: AnnotationMeasurement['type']) => {
      let anns: any[] = [];
      try {
        const annotationsForTool = (annotation.state as any).getAnnotations?.(
          toolName,
          element
        );
        anns = Array.isArray(annotationsForTool)
          ? annotationsForTool
          : [];
      } catch {
        anns = [];
      }

      // ANNOTATION_ADDED fires at draw start. Keep draft geometry out of the
      // Measurement service/UI until Cornerstone completes the interaction.
      anns = anns.filter((annotationInstance) => {
        const annotationUID = String(
          annotationInstance?.annotationUID ?? ''
        );
        return (
          Boolean(annotationUID) &&
          !isAnnotationCreationInProgress(annotationUID)
        );
      });

      return anns.map((a: any) => {
        const uid = String(a.annotationUID);

        const refId =
          a.metadata?.referencedImageId ||
          a.metadata?.imageId ||
          a.data?.imageId ||
          '';

        // imageIds from viewport (best-effort)
        const vp = (enabled!.viewport as StackViewport);
        const ids = (vp?.getImageIds?.() ?? []) as string[];

        const metaFrameIndex = Number.isFinite(Number(a?.metadata?.frameIndex))
          ? Number(a.metadata.frameIndex)
          : undefined;
        const idx = findMatchingImageIdIndex(
          ids,
          refId,
          metaFrameIndex
        );

        let frameIndex: number | undefined;
        if (idx >= 0) frameIndex = idx;
        else if (metaFrameIndex !== undefined) frameIndex = metaFrameIndex;
        else frameIndex = undefined;

        const annotationCreatedAt =
          typeof a.metadata?.createdAt === 'string' &&
          a.metadata.createdAt
            ? a.metadata.createdAt
            : undefined;
        const created =
          annotationCreatedAt ??
          createdAtByAnnotationUIDRef.current.get(uid) ??
          new Date().toISOString();
        createdAtByAnnotationUIDRef.current.set(uid, created);

        let foundSeriesUID =
          a.metadata?.seriesInstanceUID ||
          a.metadata?.seriesUID ||
          undefined;

        try {
          const refRaw = a.metadata?.referencedImageId || a.metadata?.imageId || a.data?.imageId || '';
          if (!foundSeriesUID && typeof resolveSeriesUIDRef.current === 'function' && refRaw) {
            const resolved = resolveSeriesUIDRef.current(String(refRaw));
            if (resolved) foundSeriesUID = resolved;
          }
        } catch {
          /* ignore */
        }

        if (!foundSeriesUID && seriesInstanceUID) {
          foundSeriesUID = seriesInstanceUID;
        }

        const finalFoundSeriesUID = foundSeriesUID ?? '';

        const stats: Record<string, any> = Object.values(a.data?.cachedStats || {})[0] || {};
        const handles = a.data?.handles || {};

        const flat: Record<string, any> = {};
        switch (type) {
          case 'length':
            flat.length = stats.length;
            flat.unit = stats.unit;
            break;
          case 'bidirectional':
            flat.length = stats.length;
            flat.unit = stats.unit;
            flat.width = stats.width;
            flat.widthUnit = stats.widthUnit;
            break;
          case 'arrowAnnotate':
            flat.text =
              a.data?.text ||
              a.data?.handles?.text ||
              a.data?.handles?.label ||
              a.metadata?.label ||
              '';
            break;
          case 'ellipticalROI':
          case 'rectangleROI':
          case 'circleROI':
            flat.area = stats.area;
            flat.areaUnit = stats.areaUnit;
            flat.max = stats.max;
            flat.modalityUnit = stats.modalityUnit;
            break;
          case 'splineROI':
            flat.area = stats.area;
            flat.areaUnit = stats.areaUnit;
            break;
          case 'planarFreehandROI':
            flat.closed = a.data?.contour?.closed !== false;
            flat.length = stats.length;
            flat.unit = stats.unit;
            flat.area = stats.area;
            flat.areaUnit = stats.areaUnit;
            flat.perimeter = stats.perimeter;
            flat.mean = stats.mean;
            flat.max = stats.max;
            flat.min = stats.min;
            flat.stdDev = stats.stdDev;
            flat.modalityUnit = stats.modalityUnit;
            flat.contour = cloneMeasurementData(a.data?.contour ?? {});
            break;
          case 'livewireContour':
            flat.closed = a.data?.contour?.closed !== false;
            flat.area = stats.area;
            flat.areaUnit = stats.areaUnit;
            flat.contour = cloneMeasurementData(a.data?.contour ?? {});
            break;
          case 'angle':
            flat.angle = stats.angle;
            break;
        }

        // Cornerstone mutates handle objects in place while dragging. Keep an
        // immutable snapshot so the change fingerprint can observe geometry
        // changes instead of comparing two references to the same object.
        flat.handles = cloneMeasurementData(handles);

        return {
          annotationUID: uid,
          toolName: a.metadata?.toolName || toolName,
          label: a.metadata?.label || '',
          type,
          data: { ...flat },
          metadata: {
            seriesUID: finalFoundSeriesUID,
            reportSeriesUID:
              a.metadata?.reportSeriesUID ??
              a.metadata?.reportSeriesInstanceUID,
            trackingUID: a.metadata?.trackingUID,
            studyUID: studyInstanceUID || '',
            viewportId,
            frameIndex,
            referencedImageId: refId,
            createdAt: created,
          },
          createdAt: created,
        } as AnnotationMeasurement;
      });
    };

    try {
      result.push(...collect(LengthTool.toolName, 'length'));
      result.push(...collect(BidirectionalTool.toolName, 'bidirectional'));
      result.push(...collect(ArrowAnnotateTool.toolName, 'arrowAnnotate'));
      result.push(...collect(EllipticalROITool.toolName, 'ellipticalROI'));
      result.push(...collect(RectangleROITool.toolName, 'rectangleROI'));
      result.push(...collect(CircleROITool.toolName, 'circleROI'));
      result.push(
        ...collect(
          PlanarFreehandROITool.toolName,
          'planarFreehandROI'
        )
      );
      result.push(...collect(SplineROITool.toolName, 'splineROI'));
      result.push(
        ...collect(LivewireContourTool.toolName, 'livewireContour')
      );
      result.push(...collect(AngleTool.toolName, 'angle'));
    } catch (err) {
    }

    // Sort deterministically by annotationUID to avoid order flips causing false diffs
    result.sort((a, b) => (a.annotationUID > b.annotationUID ? 1 : a.annotationUID < b.annotationUID ? -1 : 0));

    return result;
  }, [element, seriesInstanceUID, studyInstanceUID, viewportId]); // resolveSeriesUID removed from deps (we use ref)

  // We'll keep a ref to the last-collected measurements so we can call onMeasurementsChange outside setState
  const lastCollectedRef = useRef<AnnotationMeasurement[] | null>(null);

  // Safe sender: only call external callback when changed, and defer the call
  const sendMeasurementsSafe = useCallback((ms: AnnotationMeasurement[]) => {
    try {
      const key = createMeasurementListFingerprint(ms);
      if (lastSentMeasurementsKeyRef.current === key) {
        return;
      }
      lastSentMeasurementsKeyRef.current = key;

      // Defer callback to avoid nested setState in same tick
      setTimeout(() => {
        try {
          const cb = onMeasurementsChangeRef.current;
          if (typeof cb === 'function') {
            cb(ms);
          }
        } catch (e) {
        }
      }, 0);
    } catch (e) {
      try {
        const cb = onMeasurementsChangeRef.current;
        if (typeof cb === 'function') cb(ms);
      } catch {}
    }
  }, []);

  // Stable refresh function stored in a ref so effects don't re-run when refresh changes
  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => {
    const current = collectAnnotations();

    // Build next measurement array deterministicly similar to older logic
    const next = (() => {
      const prevMap: Record<string, AnnotationMeasurement> = {};
      // <-- use lastCollectedRef.current as "previous" snapshot (do NOT read 'measurements' var)
      const prevList = lastCollectedRef.current ?? [];
      prevList.forEach((m) => {
        prevMap[m.annotationUID] = m;
      });

      const map: Record<string, AnnotationMeasurement> = {};
      current.forEach((m) => {
        const old = prevMap[m.annotationUID];
        if (old) {
          if (!m.createdAt || m.createdAt === '') {
            m.createdAt = old.createdAt;
          }
          m.metadata = {
            ...(old.metadata || {}),
            ...(m.metadata || {}),
          };
          if (!m.metadata.seriesUID && old.metadata?.seriesUID) {
            m.metadata.seriesUID = old.metadata.seriesUID;
          }
          if (
            (m.metadata.frameIndex === undefined || m.metadata.frameIndex === null) &&
            typeof old.metadata?.frameIndex === 'number'
          ) {
            m.metadata.frameIndex = old.metadata.frameIndex;
          }
        }
        map[m.annotationUID] = m;
      });

      return Object.values(map).sort((a, b) => (a.annotationUID > b.annotationUID ? 1 : a.annotationUID < b.annotationUID ? -1 : 0));
    })();

    // Compare the full immutable measurement snapshots. UID/createdAt alone
    // misses handle drags and recalculated cached statistics.
    const prevArr = lastCollectedRef.current ?? [];
    const previousFingerprint = createMeasurementListFingerprint(prevArr);
    const nextFingerprint = createMeasurementListFingerprint(next);
    const equal = previousFingerprint === nextFingerprint;

    if (!equal) {
      // update ref first so future comparisons are consistent
      lastCollectedRef.current = next;

      // Only call external callback if there was a meaningful change
      try {
        // Use the safe sender (deduped + deferred)
        sendMeasurementsSafe(next);
      } catch (e) {
      }
    } else {
      // no meaningful change; still update ref for consistency, but DO NOT call external callback
      lastCollectedRef.current = next;
      // no sendMeasurementsSafe call
    }
  }, [collectAnnotations, sendMeasurementsSafe]);

  // keep refreshRef.current pointing to latest refresh
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  // Listen for annotation events (add/modify/remove) with stable handler that calls refreshRef.current
  useEffect(() => {
    let rafId: number | null = null;

    const handler = () => {
      try {
        if (rafId != null) {
          // Coalesce an event burst into the already-scheduled refresh.
          // Cancelling and rescheduling here can starve forever while
          // Cornerstone emits MODIFIED/stat events on consecutive frames.
          return;
        }
        rafId = requestAnimationFrame(() => {
          try {
            refreshRef.current();
          } catch (e) {
          } finally {
            rafId = null;
          }
        });
      } catch (e) {
        // fallback
        try { setTimeout(() => refreshRef.current(), 0); } catch {}
      }
    };

    // Register the real handler to annotation events
    try {
      eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_ADDED, handler);
      eventTarget.addEventListener(
        ToolEnums.Events.ANNOTATION_COMPLETED,
        handler
      );
      eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_MODIFIED, handler);
      eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_REMOVED, handler);
    } catch (e) {
    }

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);

      try {
        eventTarget.removeEventListener(ToolEnums.Events.ANNOTATION_ADDED, handler);
        eventTarget.removeEventListener(
          ToolEnums.Events.ANNOTATION_COMPLETED,
          handler
        );
        eventTarget.removeEventListener(ToolEnums.Events.ANNOTATION_MODIFIED, handler);
        eventTarget.removeEventListener(ToolEnums.Events.ANNOTATION_REMOVED, handler);
      } catch (e) {}
    };
  }, []);

  // When element available: call refresh immediately and schedule a few retries (helps race conditions)
  useEffect(() => {
    if (!element) return;

    try { refresh(); } catch {}

    let tries = 0;
    const maxTries = 6;
    const id = setInterval(() => {
      tries += 1;
      try { refresh(); } catch {}
      if (tries >= maxTries) clearInterval(id);
    }, 300);

    return () => clearInterval(id);
    // we want to re-run when element changes only
  }, [element, refresh]);

  const updateLabel = useCallback(
    (annotationUID: string, newLabel: string) => {
      let annotationInstance: any = null;
      try {
        annotationInstance =
          (annotation.state as any).getAnnotation?.(annotationUID) ??
          null;
        if (annotationInstance) {
          annotationInstance.metadata ??= {};
          annotationInstance.data ??= {};
          annotationInstance.metadata.label = newLabel;
          annotationInstance.data.label = newLabel;
          if (
            (annotationInstance.metadata?.toolName ??
              annotationInstance.toolName) === ArrowAnnotateTool.toolName
          ) {
            annotationInstance.data.text = newLabel;
          }
          (annotation.state as any).triggerAnnotationModified?.(
            annotationInstance,
            element,
            (ToolEnums as any).ChangeTypes?.LabelChange
          );
        }
      } catch (e) {
      }

      const nextMeasurements = (
        lastCollectedRef.current ?? []
      ).map((measurement) =>
        measurement.annotationUID === annotationUID
          ? { ...measurement, label: newLabel }
          : measurement
      );
      lastCollectedRef.current = nextMeasurements;
      lastSentMeasurementsKeyRef.current = null;
      sendMeasurementsSafe(nextMeasurements);

      // Re-read the live annotation after the event stack has settled so
      // cached stats and the canonical parent list converge as well.
      try {
        setTimeout(() => refreshRef.current(), 0);
      } catch {}
    },
    [element, sendMeasurementsSafe]
  );

  return {
    refreshMeasurements: () => refreshRef.current(),
    updateLabel,
  };
};

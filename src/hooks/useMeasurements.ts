// src/hooks/useMeasurements.ts
'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
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
  SplineROITool,
  AngleTool,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';
import { VIEWPORT_ID } from '@/constants/viewport';
import { safeGetEnabledElement, normalizeImageId as normalizeId } from '@/lib/cornerstoneHelpers';

export interface AnnotationMeasurement {
  annotationUID: string;
  toolName: string;
  label: string;
  type:
    | 'length'
    | 'bidirectional'
    | 'arrowAnnotate'
    | 'ellipticalROI'
    | 'rectangleROI'
    | 'circleROI'
    | 'splineROI'
    | 'angle';
  data: any;
  metadata: {
    seriesUID: string;
    studyUID: string;
    viewportId: string;
    frameIndex?: number;
    referencedImageId?: string;
    imageId?: string;
    createdAt: string;
  };
  createdAt: string;
}

function parseNumberArrayFromDicomJson(meta: any, tag: string): number[] | null {
  if (!meta) return null;
  const entry = meta?.[tag];
  if (!entry) return null;
  const vals = entry.Value ?? entry;
  if (!Array.isArray(vals)) return null;
  return vals.map((v: any) => Number(v));
}

function pixelToPatientCoords(pointPx: number[], meta: any): number[] | null {
  if (!meta) return null;
  const ipp = parseNumberArrayFromDicomJson(meta, '00200032');
  const iop = parseNumberArrayFromDicomJson(meta, '00200037');
  const pxSp = parseNumberArrayFromDicomJson(meta, '00280030');

  if (!ipp || !iop || !pxSp) return null;
  if (iop.length < 6 || pxSp.length < 2) return null;

  const rowCosine = [iop[0], iop[1], iop[2]];
  const colCosine = [iop[3], iop[4], iop[5]];
  const rowSpacing = Number(pxSp[0]);
  const colSpacing = Number(pxSp[1]);

  const x = Number(pointPx[0]); // column
  const y = Number(pointPx[1]); // row

  const patient: number[] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    patient[i] =
      Number(ipp[i]) +
      colCosine[i] * x * colSpacing +
      rowCosine[i] * y * rowSpacing;
  }
  return patient;
}

function euclidean(a: number[], b: number[]) {
  let s = 0;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const da = a[i] ?? 0;
    const db = b[i] ?? 0;
    s += (da - db) * (da - db);
  }
  return Math.sqrt(s);
}

function extractPointsFromInst(inst: any): number[][] | undefined {
  const d = inst?.data ?? inst;
  const handles = d?.handles ?? d;

  if (Array.isArray(handles?.points) && handles.points.length) {
    const p = handles.points
      .map((pt: any) => {
        if (Array.isArray(pt) && pt.length >= 2) return [Number(pt[0]), Number(pt[1])];
        if (pt && typeof pt.x === 'number' && typeof pt.y === 'number') return [Number(pt.x), Number(pt.y)];
        if (pt && Array.isArray(pt.position) && pt.position.length >= 2) return [Number(pt.position[0]), Number(pt.position[1])];
        return null;
      })
      .filter(Boolean);
    if (p.length) return p as number[][];
  }

  if (handles?.start && handles?.end) {
    const s = handles.start;
    const e = handles.end;
    const p1 = Array.isArray(s) && s.length >= 2 ? [Number(s[0]), Number(s[1])] : (s && s.x != null ? [Number(s.x), Number(s.y)] : null);
    const p2 = Array.isArray(e) && e.length >= 2 ? [Number(e[0]), Number(e[1])] : (e && e.x != null ? [Number(e.x), Number(e.y)] : null);
    if (p1 && p2) return [p1, p2];
  }

  if (Array.isArray(handles?.controlPoints) && handles.controlPoints.length) {
    const p = handles.controlPoints
      .map((pt: any) => {
        if (Array.isArray(pt) && pt.length >= 2) return [Number(pt[0]), Number(pt[1])];
        if (pt && typeof pt.x === 'number') return [Number(pt.x), Number(pt.y)];
        return null;
      })
      .filter(Boolean);
    if (p.length) return p as number[][];
  }

  if (handles && typeof handles === 'object' && !Array.isArray(handles)) {
    for (const k of Object.keys(handles)) {
      const v = handles[k];
      if (Array.isArray(v) && v.length) {
        const p = v
          .map((pt: any) => {
            if (Array.isArray(pt) && pt.length >= 2) return [Number(pt[0]), Number(pt[1])];
            if (pt && typeof pt.x === 'number') return [Number(pt.x), Number(pt.y)];
            if (pt && Array.isArray(pt.position) && pt.position.length >= 2) return [Number(pt.position[0]), Number(pt.position[1])];
            return null;
          })
          .filter(Boolean);
        if (p.length) return p as number[][];
      }
    }
  }

  return undefined;
}

/**
 * Main hook: collect annotation instances from cornerstone (robustly),
 * convert them to AnnotationMeasurement[] and provide refresh/updateLabel.
 *
 * Key fixes:
 * - Avoid using resolveSeriesUID directly as dependency by storing into ref.
 * - Calls onMeasurementsChange OUTSIDE of setState and defers it
 * - Avoids calling the external callback when nothing meaningful changed
 */
export const useViewportAnnotations = ({
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
  const [measurements, setMeasurements] = useState<AnnotationMeasurement[]>([]);

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

  // normalize different return shapes from annotation.state.getAnnotations(...)
  function normalizeGetAnnotationsResult(annsRaw: any): any[] {
    if (!annsRaw) return [];
    if (Array.isArray(annsRaw)) return annsRaw;
    try {
      if (annsRaw instanceof Map) {
        const out: any[] = [];
        annsRaw.forEach((v: any) => {
          if (Array.isArray(v)) out.push(...v);
          else if (v) out.push(v);
        });
        return out;
      }
      if (typeof annsRaw === 'object') {
        const out: any[] = [];
        Object.values(annsRaw).forEach((v: any) => {
          if (Array.isArray(v)) out.push(...v);
          else if (v) out.push(v);
        });
        return out;
      }
    } catch (e) {
      // swallow and fallthrough
    }
    return [];
  }

  // robust getter: try element-scoped and global-scoped variants
  function getAnnotationsRobust(toolName: string | undefined, el: HTMLDivElement | null) {
    let anns: any[] = [];
    try {
      const annStateAny: any = annotation.state;

      // 1) element + tool
      try {
        const r = annStateAny.getAnnotations?.(toolName ?? undefined, el ?? null);
        anns = normalizeGetAnnotationsResult(r);
        if (anns.length) return anns;
      } catch (e) { /* continue */ }

      // 2) element + all
      try {
        const r = annStateAny.getAnnotations?.(undefined, el ?? null);
        anns = normalizeGetAnnotationsResult(r);
        if (anns.length) return anns;
      } catch (e) { /* continue */ }

      // 3) global + tool
      try {
        const r = annStateAny.getAnnotations?.(toolName ?? undefined, undefined);
        anns = normalizeGetAnnotationsResult(r);
        if (anns.length) return anns;
      } catch (e) { /* continue */ }

      // 4) global all
      try {
        const r = annStateAny.getAnnotations?.(undefined, undefined);
        anns = normalizeGetAnnotationsResult(r);
        if (anns.length) return anns;
      } catch (e) { /* continue */ }
    } catch (e) {
      // fallback empty
      anns = [];
    }
    return anns;
  }

  const collectAnnotations = useCallback((): AnnotationMeasurement[] => {
    if (!element) return [];
    let enabled;
    try {
      // Use safe helper that gracefully handles missing/broken cornerstone exports
      enabled = safeGetEnabledElement(element);
    } catch {
      // fallback: attempt to call global cornerstone if present
      try {
        // @ts-ignore
        if (typeof (globalThis as any).cornerstone?.getEnabledElement === 'function') {
          // @ts-ignore
          enabled = (globalThis as any).cornerstone.getEnabledElement(element);
        }
      } catch {
        enabled = null;
      }
    }
    if (!enabled) return [];

    const result: AnnotationMeasurement[] = [];

    const collect = (toolName: string, type: AnnotationMeasurement['type']) => {
      let anns: any[] = [];
      try {
        anns = getAnnotationsRobust(toolName, element) || [];
      } catch (e) {
        anns = [];
      }

      // If getAnnotations returned mixed tool types, try to filter by toolName
      if (anns.length && anns.some((a) => (a?.toolName ?? a?.metadata?.toolName) !== toolName)) {
        anns = anns.filter((a) => (a?.toolName ?? a?.metadata?.toolName ?? '') === toolName);
      }

      return anns.map((a: any) => {
        const uid = a.annotationUID ?? a.uid ?? a.id ?? String(Math.random());

        const refId =
          a.metadata?.referencedImageId ||
          a.metadata?.imageId ||
          a.data?.imageId ||
          '';

        // imageIds from viewport (best-effort)
        const vp = (enabled!.viewport as StackViewport);
        const ids = (vp?.getImageIds?.() ?? []) as string[];

        const normRef = normalizeId(refId);
        const idx = ids.findIndex((id) => normalizeId(id) === normRef);

        const metaFrameIndex = Number.isFinite(Number(a?.metadata?.frameIndex))
          ? Number(a.metadata.frameIndex)
          : undefined;

        let frameIndex: number | undefined;
        if (idx >= 0) frameIndex = idx;
        else if (metaFrameIndex !== undefined) frameIndex = metaFrameIndex;
        else frameIndex = undefined;

        const created = a.metadata?.createdAt || new Date().toISOString();

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
          case 'angle':
            flat.angle = stats.angle;
            break;
        }

        flat.handles = handles;

        // try convert px->mm where possible
        try {
          if ((type === 'length' || type === 'bidirectional' || type === 'arrowAnnotate' || type === 'angle')) {
            if (flat.unit !== 'mm') {
              const metaManager = (typeof window !== 'undefined' && (window as any).wadorsMetaDataManager)
                ? (window as any).wadorsMetaDataManager
                : null;

              let meta: any = null;
              if (metaManager && refId) {
                try {
                  meta = metaManager.get?.(refId) ?? null;
                } catch {
                  try {
                    meta = metaManager.get?.(String(refId).replace(/^imageId:/, '')) ?? null;
                  } catch {
                    meta = null;
                  }
                }
              }

              const pts = extractPointsFromInst(a);
              if (pts && pts.length >= 2) {
                const p0 = meta ? pixelToPatientCoords(pts[0], meta) : null;
                const p1 = meta ? pixelToPatientCoords(pts[1], meta) : null;

                if (p0 && p1) {
                  const lenmm = euclidean(p0, p1);
                  flat.length = Number(lenmm);
                  flat.unit = 'mm';
                } else if (meta) {
                  const pxSp = parseNumberArrayFromDicomJson(meta, '00280030');
                  if (pxSp && Array.isArray(pxSp) && pxSp.length >= 2) {
                    const avg = (Number(pxSp[0]) + Number(pxSp[1])) / 2;
                    const lenpx = flat.length ?? stats.length ?? null;
                    if (typeof lenpx === 'number') {
                      flat.length = Number((lenpx * avg).toFixed(3));
                      flat.unit = 'mm';
                    }
                  }
                }
              }
            }
          }
        } catch {
          // noop
        }

        return {
          annotationUID: uid,
          toolName: a.metadata?.toolName || toolName,
          label: a.metadata?.label || '',
          type,
          data: { ...flat },
          metadata: {
            seriesUID: finalFoundSeriesUID,
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
      result.push(...collect(SplineROITool.toolName, 'splineROI'));
      result.push(...collect(AngleTool.toolName, 'angle'));
    } catch (err) {
      console.error('[useMeasurements] collectAnnotations error', err);
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
      const key = ms.map(m => `${String(m.annotationUID)}|${String(m.createdAt ?? '')}`).join(',');
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
          console.warn('[useMeasurements] onMeasurementsChange threw', e);
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

    // Compare previous and next using UID-keyed comparison (order-insensitive)
    const prevArr = lastCollectedRef.current ?? [];
    const prevMapForCompare: Record<string, { createdAt?: string; label?: string; frame?: number | undefined }> = {};
    prevArr.forEach((p) => {
      prevMapForCompare[p.annotationUID] = { createdAt: p.createdAt, label: p.label, frame: p.metadata?.frameIndex };
    });

    const equal =
      prevArr.length === next.length &&
      next.every((m) => {
        const o = prevMapForCompare[m.annotationUID];
        if (!o) return false;
        return o.createdAt === m.createdAt && o.label === m.label && o.frame === m.metadata?.frameIndex;
      });

    if (!equal) {
      // update ref first so future comparisons are consistent
      lastCollectedRef.current = next;

      // Defer actual setState to avoid synchronous reentrancy inside Cornerstone event stack
      try {
        setTimeout(() => {
          try {
            setMeasurements(next);
          } catch (e) {
            // swallow
          }
        }, 0);
      } catch (e) {
        // fallback to direct set
        try {
          setMeasurements(next);
        } catch {}
      }

      // Only call external callback if there was a meaningful change
      try {
        // Use the safe sender (deduped + deferred)
        sendMeasurementsSafe(next);
      } catch (e) {
        console.warn('[useMeasurements] sendMeasurementsSafe failed', e);
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
          cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(() => {
          try {
            refreshRef.current();
          } catch (e) {
            console.debug('[useMeasurements] refresh handler error', e);
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
      eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_MODIFIED, handler);
      eventTarget.addEventListener(ToolEnums.Events.ANNOTATION_REMOVED, handler);
    } catch (e) {
      console.warn('[useMeasurements] failed to add main annotation handlers', e);
    }

    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);

      try {
        eventTarget.removeEventListener(ToolEnums.Events.ANNOTATION_ADDED, handler);
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
      try {
        const ann = (annotation.state as any).getAnnotation?.(annotationUID) ?? null;
        if (ann && ann.metadata) {
          (ann.metadata as any).label = newLabel;
        }
      } catch (e) {
        console.warn('[useMeasurements] updateLabel: failed to update annotation metadata', e);
      }

      setMeasurements((ms) =>
        ms.map((m) =>
          m.annotationUID === annotationUID
            ? { ...m, label: newLabel }
            : m
        )
      );
      // call refresh asynchronously (so label change propagated)
      try { setTimeout(() => refreshRef.current(), 0); } catch {}
    },
    []
  );

  return {
    measurements,
    refreshMeasurements: () => refreshRef.current(),
    updateLabel,
  };
};

export const useMeasurements = useViewportAnnotations;
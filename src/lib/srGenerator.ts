// src/lib/srGenerator.ts
import { annotation as csAnnotation } from '@cornerstonejs/tools';

export interface SRMeasurement {
  annotationUID: string;
  trackingUniqueIdentifier?: string;
  toolName: string;
  finding?: string;
  imageIndex?: number;
  values?: Record<string, number | string | boolean | null>;
  coordinates?: {
    world?: number[][];
    patient?: number[][];
    image?: number[][];
  };
  referencedSOPInstanceUID?: string | null;
  frameOfReferenceUID?: string | null;
}

export interface CreateSRRequest {
  request: 'CreateStructuredReport';
  type?: string;
  seriesUID?: string | null;
  studyUID: string;
  patientName?: string | null;
  patientID?: string | null;
  patientBirthDate?: string | null;
  patientSex?: string | null;
  documentTitle?: string | null;
  measurements: SRMeasurement[];
  _issues?: string[];
  generatedAt?: string;
}

const PLACEHOLDER = null;

/**
 * Read DICOM JSON tag and try to return a plain string (Value[0] if present).
 * Returns null when not available or not a string.
 */
const getDicomTagString = (dicomJson: any, tag: string): string | null => {
  try {
    const entry = dicomJson?.[tag];
    if (!entry) return null;

    // Common DICOM JSON layout: { "vr": "PN", "Value": ["NGUYEN^VAN^A"] }
    if (Array.isArray(entry.Value) && entry.Value.length > 0) {
      const v0 = entry.Value[0];
      if (typeof v0 === 'string') return v0;
      // Sometimes the value is still an object; try common subfields
      if (v0 && typeof v0 === 'object') {
        // For PN objects, DICOM JSON may have Alphabetic component etc
        if (typeof v0.Alphabetic === 'string') return v0.Alphabetic;
        if (typeof v0.alphabetic === 'string') return v0.alphabetic;
      }
    }

    // Some providers may store directly as a string at the tag key
    if (typeof entry === 'string') return entry;

    return null;
  } catch (e) {
    return null;
  }
};

/** Normalize date-like strings to YYYYMMDD, or return null if not possible */
const normalizeDateToYYYYMMDD = (raw?: string | null): string | null => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // If already digits only and length 8, assume OK
  const digits = s.replace(/[^0-9]/g, '');
  if (digits.length === 8) return digits;
  // If given like YYYY-MM-DD or YYYY/MM/DD
  const m = s.match(/(\d{4}).?(\d{1,2}).?(\d{1,2})/);
  if (m) {
    const y = m[1].padStart(4, '0');
    const mm = m[2].padStart(2, '0');
    const dd = m[3].padStart(2, '0');
    return `${y}${mm}${dd}`;
  }
  return null;
};

/** Try to find metadata object stored in metaManager for a given imageId (best-effort) */
function tryGetMeta(metaManager: any, imageId?: string | null) {
  if (!metaManager || !imageId) return null;
  try {
    const raw = String(imageId || '');
    const candidates = [
      raw,
      raw.replace(/^imageId:/, ''),
      raw.split('?')[0],
      raw.replace(/^imageId:/, '').split('?')[0],
    ].filter(Boolean);

    for (const key of candidates) {
      try {
        if (typeof metaManager.get === 'function') {
          const meta = metaManager.get(key);
          if (meta) return meta;
        } else if (metaManager[key]) {
          return metaManager[key];
        }
      } catch {
        // continue
      }
    }

    // some managers store keys using the SOPInstanceUID or last path segment
    try {
      const alt = raw.replace(/^imageId:/, '').split('/').pop() ?? '';
      if (alt) {
        if (typeof metaManager.get === 'function') {
          const m2 = metaManager.get(alt);
          if (m2) return m2;
        } else if (metaManager[alt]) {
          return metaManager[alt];
        }
      }
    } catch {
      // ignore
    }

    return null;
  } catch {
    return null;
  }
}

function parseNumberArrayFromDicomJson(meta: any, tag: string): number[] | null {
  if (!meta) return null;
  const entry = meta?.[tag];
  if (!entry) return null;
  const vals = entry.Value ?? entry;
  if (!Array.isArray(vals)) return null;
  return vals.map((v: any) => Number(v));
}

/**
 * Convert pixel coordinates [col(x), row(y)] to patient coordinates in mm
 * requires tags: ImagePositionPatient (00200032), ImageOrientationPatient (00200037), PixelSpacing (00280030)
 */
function pixelToPatientCoords(pointPx: number[], meta: any): number[] | null {
  if (!meta) return null;
  const ipp = parseNumberArrayFromDicomJson(meta, '00200032'); // ImagePositionPatient
  const iop = parseNumberArrayFromDicomJson(meta, '00200037'); // ImageOrientationPatient
  const pxSp = parseNumberArrayFromDicomJson(meta, '00280030'); // PixelSpacing (row, col)

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

/** Robust extractor for pixel points from many tool shapes */
function extractPointsFromInst(inst: any): number[][] | undefined {
  const d = inst?.data ?? inst;
  const handles = d?.handles ?? d;

  // 1) handles.points common pattern
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

  // 2) start/end pair (length)
  if (handles?.start && handles?.end) {
    const s = handles.start;
    const e = handles.end;
    const p1 = Array.isArray(s) && s.length >= 2 ? [Number(s[0]), Number(s[1])] : (s && s.x != null ? [Number(s.x), Number(s.y)] : null);
    const p2 = Array.isArray(e) && e.length >= 2 ? [Number(e[0]), Number(e[1])] : (e && e.x != null ? [Number(e.x), Number(e.y)] : null);
    if (p1 && p2) return [p1, p2];
  }

  // 3) controlPoints
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

  // 4) other object-like containers
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
 * Build CreateSRRequest JSON from Cornerstone annotations.
 * - Not binary DICOM SR.
 * - Tries best-effort to include referenced SOP + frameOfReference + patient coords + length_mm.
 */
export function buildStructuredReport(
  studyUID: string,
  annotationUIDs: string[],
  opts?: { documentTitle?: string }
): CreateSRRequest {
  const instances = annotationUIDs
    .map((uid) => csAnnotation.state.getAnnotation(uid))
    .filter(Boolean)
    .map((inst: any) => JSON.parse(JSON.stringify(inst)));

  const metaManager = (typeof window !== 'undefined' && (window as any).wadorsMetaDataManager)
    ? (window as any).wadorsMetaDataManager
    : null;

  let patientName: string | null = null;
  let patientID: string | null = null;
  let patientBirthDate: string | null = null;
  let patientSex: string | null = null;
  let seriesUID: string | null = null;
  let documentTitle = opts?.documentTitle ?? 'Structured Report';

  if (instances.length > 0) {
    const first = instances[0];
    const refImageId: string | undefined = first?.metadata?.referencedImageId || first?.metadata?.imageId;
    try {
      if (metaManager && refImageId) {
        const meta = tryGetMeta(metaManager, refImageId);
        if (meta) {
          const pn = getDicomTagString(meta, '00100010');
          const pid = getDicomTagString(meta, '00100020');
          const pbdRaw = getDicomTagString(meta, '00100030');
          const ps = getDicomTagString(meta, '00100040');
          const sUID = getDicomTagString(meta, '0020000E');
          const studyDesc = getDicomTagString(meta, '00081030');

          if (pn) patientName = pn;
          if (pid) patientID = pid;
          if (pbdRaw) patientBirthDate = normalizeDateToYYYYMMDD(pbdRaw);
          if (ps) patientSex = ps;
          if (sUID) seriesUID = sUID;
          if (studyDesc) {
            documentTitle = `${documentTitle} - ${studyDesc}`;
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }

  const reportIssues: string[] = [];

  const measurements: SRMeasurement[] = instances.map((inst: any, idx: number) => {
    const annotationUID = inst.annotationUID ?? `${studyUID}.sr.${Date.now()}.${idx}`;
    const toolName = inst?.metadata?.toolName ?? inst?.toolName ?? 'Unknown';
    const finding = inst?.data?.label ?? inst?.label ?? '';
    const imageIndex =
      typeof inst?.metadata?.sliceIndex === 'number'
        ? inst.metadata.sliceIndex
        : typeof inst?.metadata?.frameIndex === 'number'
        ? inst.metadata.frameIndex
        : undefined;

    // resolve referenced image id
    const refImageId: string | undefined =
      inst?.metadata?.referencedImageId ||
      inst?.metadata?.imageId ||
      inst?.data?.imageId ||
      inst?.metadata?.referencedSOPInstanceUID ||
      inst?.metadata?.sopInstanceUID ||
      undefined;

    if (!refImageId) {
      reportIssues.push(`annotation ${annotationUID}: missing referencedImageId`);
      console.warn(`[SR] annotation ${annotationUID}: missing referencedImageId`);
    }

    const meta = tryGetMeta(metaManager, refImageId);

    // determine referenced SOP UID
    let referencedSOPInstanceUID: string | null = null;
    if (meta) {
      referencedSOPInstanceUID = getDicomTagString(meta, '00080018') || null;
    }
    if (!referencedSOPInstanceUID && refImageId) {
      const m = String(refImageId).replace(/^imageId:/, '').match(/\/instances\/([^\/]+)/);
      if (m && m[1]) referencedSOPInstanceUID = m[1];
      else {
        const cand = String(refImageId).split('/').pop();
        if (cand && cand.includes('.')) referencedSOPInstanceUID = cand;
      }
    }
    if (!referencedSOPInstanceUID) referencedSOPInstanceUID = inst?.metadata?.sopInstanceUID || inst?.sopInstanceUID || null;
    if (!referencedSOPInstanceUID) {
      reportIssues.push(`annotation ${annotationUID}: could not determine referencedSOPInstanceUID`);
      console.warn(`[SR] annotation ${annotationUID}: could not determine referencedSOPInstanceUID`);
    }

    const frameOfReferenceUID = meta ? (getDicomTagString(meta, '00200052') || null) : (inst?.metadata?.frameOfReferenceUID ?? null);

    // extract pixel points robustly
    const pixelPoints = extractPointsFromInst(inst);
    if (!pixelPoints || pixelPoints.length === 0) {
      reportIssues.push(`annotation ${annotationUID}: no pixel points extracted`);
      console.warn(`[SR] annotation ${annotationUID}: no pixel points extracted`);
    }

    // compute pixel length if possible
    let length_px: number | undefined = undefined;
    if (pixelPoints && pixelPoints.length >= 2) {
      const a = pixelPoints[0], b = pixelPoints[1];
      const dx = a[0] - b[0], dy = a[1] - b[1];
      length_px = Math.sqrt(dx * dx + dy * dy);
    } else {
      // try cachedStats fallback
      try {
        if (inst?.data?.cachedStats) {
          const keys = Object.keys(inst.data.cachedStats);
          if (keys.length > 0) {
            const stat = inst.data.cachedStats[keys[0]];
            if (stat?.length != null) length_px = Number(stat.length);
          }
        }
      } catch (e) {
        // ignore
      }
    }

    // compute mm length if possible
    let length_mm: number | null = null;
    let mmComputed = false; // true if computed from patient coords (best), or from PixelSpacing as fallback.
    if (pixelPoints && pixelPoints.length >= 2 && meta) {
      try {
        const p0 = pixelToPatientCoords(pixelPoints[0], meta);
        const p1 = pixelToPatientCoords(pixelPoints[1], meta);
        if (p0 && p1) {
          length_mm = euclidean(p0, p1);
          mmComputed = true;
        }
      } catch (e) {
        // ignore
      }
    }

    // if mm not computed but PixelSpacing exists we can approximate by avg spacing * px
    if (length_mm == null && length_px != null && meta) {
      const pxSp = parseNumberArrayFromDicomJson(meta, '00280030');
      if (pxSp && Array.isArray(pxSp) && pxSp.length >= 2) {
        const avg = (Number(pxSp[0]) + Number(pxSp[1])) / 2;
        length_mm = Number((length_px * avg).toFixed(3));
        mmComputed = false; // fallback conversion
      }
    }

    // Build values object consistently (numbers or null)
    const values: Record<string, number | string | boolean | null> = {};
    values['length_px'] = length_px != null ? Number(Number(length_px).toFixed(3)) : null;
    if (length_mm != null) {
      values['length_mm'] = Number(Number(length_mm).toFixed(3));
      values['unit'] = 'mm';
      values['mmComputed'] = mmComputed;
    } else {
      values['length_mm'] = null;
      values['unit'] = 'px';
      values['mmComputed'] = false;
    }

    // coordinates: include image (pixel) always if available, and patient if available
    const coordsObj: any = {};
    if (pixelPoints && pixelPoints.length) {
      coordsObj.image = pixelPoints.map((pt: any) => [Number(pt[0]), Number(pt[1])]);
    }
    if (meta && pixelPoints && pixelPoints.length) {
      try {
        const patientPts = pixelPoints
          .map((pt) => pixelToPatientCoords(pt, meta))
          .filter(Boolean) as number[][];
        if (patientPts && patientPts.length) coordsObj.patient = patientPts;
        if (patientPts && patientPts.length) coordsObj.world = patientPts;
      } catch (e) {
        // ignore
      }
    } else if (pixelPoints && pixelPoints.length) {
      coordsObj.world = pixelPoints.map((pt: any) => [Number(pt[0]), Number(pt[1])]);
    }

    const measurement: SRMeasurement = {
      annotationUID,
      trackingUniqueIdentifier: annotationUID,
      toolName,
      finding,
      imageIndex,
      values: Object.keys(values).length ? (values as any) : undefined,
      coordinates: Object.keys(coordsObj).length ? coordsObj : undefined,
      referencedSOPInstanceUID: referencedSOPInstanceUID ?? null,
      frameOfReferenceUID: frameOfReferenceUID ?? null,
    };

    // NOTE: use bracket access to avoid TypeScript linting errors on keys with underscores
    if (measurement.values?.['length_px'] == null && measurement.values?.['length_mm'] == null) {
      reportIssues.push(`annotation ${annotationUID}: no length info available`);
    }

    return measurement;
  });

  // Build final report with server-friendly plain fields
  const report: CreateSRRequest = {
    request: 'CreateStructuredReport',
    type: 'StructuredReport',
    studyUID,
    generatedAt: new Date().toISOString(),
    seriesUID: seriesUID ?? null,
    patientName: patientName ?? null,
    patientID: patientID ?? null,
    patientBirthDate: patientBirthDate ?? null,
    patientSex: patientSex ?? null,
    documentTitle,
    measurements,
  };

  (report as any)._issues = reportIssues;

  if (reportIssues.length) console.warn('SR generation issues:', reportIssues);

  return report;
}

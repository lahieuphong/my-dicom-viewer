import fs from 'fs';
import path from 'path';

type DicomInstance = {
  sopInstanceUID?: string;
  instanceNumber?: number | null;
  url: string;
  filename?: string;
};

type DicomSeries = {
  seriesInstanceUID: string;
  seriesDescription: string;
  seriesNumber: string;
  seriesModality: string;
  seriesRelatedInstanceCount: string;
  instances?: DicomInstance[];
};

type DicomStudy = {
  studyInstanceUID: string;
  patientName: string;
  patientId: string;
  studyDate: string;
  studyTime: string;
  studyDescription: string;
  accessionNumber: string;
  modalitiesInStudy: string;
  seriesCount: number;
  imageCount: number;
  series: DicomSeries[];
};

const manifestPath = path.join(process.cwd(), 'public', 'dicom-manifest.json');

let manifestCache: { mtimeMs: number; studies: DicomStudy[] } | null = null;

/**
 * Static sample data source.
 *
 * Runtime requests intentionally read only the pre-generated manifest. This keeps
 * /api/studies cheap and predictable for large demo folders, and mirrors the
 * production shape where a PACS/backend has already indexed metadata.
 *
 * For local sample DICOMs, regenerate with:
 *   yarn dicom:manifest
 */

function safeString(val: unknown, fallback = '-'): string {
  if (val == null) return fallback;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
    const s = String(val);
    return s === '' ? fallback : s;
  }
  try {
    return JSON.stringify(val);
  } catch {
    return fallback;
  }
}

function normalizeStudies(raw: unknown): DicomStudy[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((study: any) => {
    const series = Array.isArray(study.series) ? study.series : [];
    const normalizedSeries = series.map((item: any) => {
      const instances = Array.isArray(item.instances) ? item.instances : [];
      return {
        seriesInstanceUID: safeString(item.seriesInstanceUID, ''),
        seriesDescription: safeString(item.seriesDescription, '-'),
        seriesNumber: safeString(item.seriesNumber, ''),
        seriesModality: safeString(item.seriesModality ?? item.modality, ''),
        seriesRelatedInstanceCount: safeString(
          item.seriesRelatedInstanceCount ?? instances.length,
          '0'
        ),
        instances,
      };
    });

    const imageCount =
      Number(study.imageCount) ||
      normalizedSeries.reduce(
        (sum: number, item: DicomSeries) => sum + (Number(item.seriesRelatedInstanceCount) || 0),
        0
      );

    return {
      studyInstanceUID: safeString(study.studyInstanceUID, ''),
      patientName: safeString(study.patientName, '-'),
      patientId: safeString(study.patientId, '-'),
      studyDate: safeString(study.studyDate, '-'),
      studyTime: safeString(study.studyTime, ''),
      studyDescription: safeString(study.studyDescription, '-'),
      accessionNumber: safeString(study.accessionNumber, '-'),
      modalitiesInStudy: safeString(study.modalitiesInStudy, '-'),
      seriesCount: Number(study.seriesCount) || normalizedSeries.length,
      imageCount,
      series: normalizedSeries,
    };
  });
}

function readManifest(): DicomStudy[] | null {
  try {
    if (!fs.existsSync(manifestPath)) return null;

    const stat = fs.statSync(manifestPath);
    if (manifestCache && manifestCache.mtimeMs === stat.mtimeMs) {
      return manifestCache.studies;
    }

    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const studies = normalizeStudies(Array.isArray(raw) ? raw : raw?.studies);
    manifestCache = { mtimeMs: stat.mtimeMs, studies };
    return studies;
  } catch {
    return null;
  }
}

export function getDicomIndex(): DicomStudy[] {
  const manifest = readManifest();
  return manifest ?? [];
}

export function getStudySummaries(): DicomStudy[] {
  return getDicomIndex().map((study) => ({
    ...study,
    series: [],
  }));
}

export function getStudySummary(studyUID: string): DicomStudy | null {
  const decodedUID = decodeURIComponent(studyUID);
  const study = getDicomIndex().find((item) => item.studyInstanceUID === decodedUID);
  return study ? { ...study, series: [] } : null;
}

function withoutInstances(series: DicomSeries[]): DicomSeries[] {
  return series.map((item) => ({
    ...item,
    instances: undefined,
  }));
}

export function getSeriesForStudy(studyUID: string, options: { includeInstances?: boolean } = {}): DicomSeries[] {
  const decodedUID = decodeURIComponent(studyUID);
  const series = getDicomIndex().find((study) => study.studyInstanceUID === decodedUID)?.series ?? [];
  return options.includeInstances === false ? withoutInstances(series) : series;
}

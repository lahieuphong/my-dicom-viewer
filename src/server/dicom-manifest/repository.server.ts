import 'server-only';

import fs from 'fs';
import path from 'path';

import type {
  DicomManifestSeries,
  DicomManifestStudy,
  GetSeriesForStudyOptions,
} from './types';

/**
 * Server-only repository for the generated DICOM manifest.
 *
 * Runtime requests read only the pre-generated manifest. This keeps the HTTP
 * routes cheap and prevents filesystem concerns from leaking into client code.
 */

const manifestPath = path.join(process.cwd(), 'public', 'dicom-manifest.json');

let manifestCache: {
  mtimeMs: number;
  studies: DicomManifestStudy[];
} | null = null;

function safeString(value: unknown, fallback = '-'): string {
  if (value == null) return fallback;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    const normalized = String(value);
    return normalized === '' ? fallback : normalized;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function normalizeStudies(raw: unknown): DicomManifestStudy[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((study: any) => {
    const series = Array.isArray(study.series) ? study.series : [];
    const normalizedSeries: DicomManifestSeries[] = series.map((item: any) => {
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
        (sum, item) =>
          sum + (Number(item.seriesRelatedInstanceCount) || 0),
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

function readManifest(): DicomManifestStudy[] | null {
  try {
    if (!fs.existsSync(manifestPath)) return null;

    const stat = fs.statSync(manifestPath);
    if (manifestCache?.mtimeMs === stat.mtimeMs) {
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

export function getDicomIndex(): DicomManifestStudy[] {
  return readManifest() ?? [];
}

export function getStudySummaries(): DicomManifestStudy[] {
  return getDicomIndex().map((study) => ({
    ...study,
    series: [],
  }));
}

export function getStudySummary(studyUID: string): DicomManifestStudy | null {
  const decodedUID = decodeURIComponent(studyUID);
  const study = getDicomIndex().find(
    (item) => item.studyInstanceUID === decodedUID
  );

  return study ? { ...study, series: [] } : null;
}

function withoutInstances(
  series: DicomManifestSeries[]
): DicomManifestSeries[] {
  return series.map((item) => ({
    ...item,
    instances: undefined,
  }));
}

export function getSeriesForStudy(
  studyUID: string,
  options: GetSeriesForStudyOptions = {}
): DicomManifestSeries[] {
  const decodedUID = decodeURIComponent(studyUID);
  const series =
    getDicomIndex().find(
      (study) => study.studyInstanceUID === decodedUID
    )?.series ?? [];

  return options.includeInstances === false ? withoutInstances(series) : series;
}

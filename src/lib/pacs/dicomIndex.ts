import fs from 'fs';
import path from 'path';
import dcmjs from 'dcmjs';

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

const dicomDir = path.join(process.cwd(), 'public', 'dicoms');
const manifestPath = path.join(process.cwd(), 'public', 'dicom-manifest.json');
const FALLBACK_CACHE_TTL_MS = 30 * 1000;

let manifestCache: { mtimeMs: number; studies: DicomStudy[] } | null = null;
let fallbackCache: { createdAt: number; studies: DicomStudy[] } | null = null;

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

function formatPersonName(pn: any): string {
  if (!pn) return '-';
  if (typeof pn === 'string') return pn;
  if (typeof pn === 'object') {
    if ('Alphabetic' in pn || 'Ideographic' in pn || 'Phonetic' in pn) {
      const parts = [pn.Alphabetic, pn.Ideographic, pn.Phonetic].filter(Boolean).map(String);
      return parts.length ? parts.join('\\') : '-';
    }
    if (Array.isArray(pn)) {
      return pn.map(formatPersonName).filter(Boolean).join('\\') || '-';
    }
    if ('Value' in pn && Array.isArray(pn.Value)) {
      return formatPersonName(pn.Value[0]);
    }
    const vals = Object.values(pn).filter((v) => typeof v === 'string' || typeof v === 'number');
    if (vals.length) return vals.join('\\');
  }
  return '-';
}

function addModalities(set: Set<string>, modality: string | undefined) {
  if (!modality) return;
  String(modality)
    .split(/\\|,/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((part) => set.add(part));
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

function parseDicomDirectory(): DicomStudy[] {
  if (!fs.existsSync(dicomDir)) return [];

  const fileNames = fs.readdirSync(dicomDir).filter((file) => /\.dcm$/i.test(file));
  const studiesMap: Map<string, any> = new Map();

  for (const filename of fileNames) {
    const filePath = path.join(dicomDir, filename);
    let dataset: any = {};

    try {
      const buffer = fs.readFileSync(filePath);
      const uint8 = new Uint8Array(buffer);
      const dicomMessage = dcmjs.data.DicomMessage.readFile(uint8);
      dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomMessage.dict || {});
    } catch {
      dataset = {};
    }

    const studyInstanceUID = dataset.StudyInstanceUID || `no-study-${filename}`;
    const seriesInstanceUID = dataset.SeriesInstanceUID || `no-series-${filename}`;
    const sopInstanceUID = dataset.SOPInstanceUID || filename;
    const instanceNumber = dataset.InstanceNumber ?? null;
    const patientName = formatPersonName(dataset.PatientName);
    const patientId = safeString(dataset.PatientID, '-');
    const studyDate = safeString(dataset.StudyDate, '-');
    const studyTime = safeString(dataset.StudyTime, '');
    const studyDescription = safeString(dataset.StudyDescription, '-');
    const accessionNumber = safeString(dataset.AccessionNumber, '-');
    const seriesDescription = safeString(dataset.SeriesDescription, '-');
    const seriesNumber = safeString(dataset.SeriesNumber, '');
    const modality = safeString(dataset.Modality, '');
    const instanceFilename = `/dicoms/${filename}`;

    if (!studiesMap.has(studyInstanceUID)) {
      studiesMap.set(studyInstanceUID, {
        studyInstanceUID,
        patientName,
        patientId,
        studyDate,
        studyTime,
        studyDescription,
        accessionNumber,
        modalitiesInStudySet: new Set<string>(),
        series: new Map<string, any>(),
      });
    }

    const studyObj = studiesMap.get(studyInstanceUID);
    if ((!studyObj.patientName || studyObj.patientName === '-') && patientName && patientName !== '-') {
      studyObj.patientName = patientName;
    }
    if ((!studyObj.patientId || studyObj.patientId === '-') && patientId && patientId !== '-') {
      studyObj.patientId = patientId;
    }
    if ((!studyObj.studyDescription || studyObj.studyDescription === '-') && studyDescription && studyDescription !== '-') {
      studyObj.studyDescription = studyDescription;
    }
    if ((!studyObj.accessionNumber || studyObj.accessionNumber === '-') && accessionNumber && accessionNumber !== '-') {
      studyObj.accessionNumber = accessionNumber;
    }
    if ((!studyObj.studyDate || studyObj.studyDate === '-') && studyDate && studyDate !== '-') {
      studyObj.studyDate = studyDate;
    }

    addModalities(studyObj.modalitiesInStudySet, modality);

    if (!studyObj.series.has(seriesInstanceUID)) {
      studyObj.series.set(seriesInstanceUID, {
        seriesInstanceUID,
        seriesDescription,
        seriesNumber,
        modality,
        instances: [] as DicomInstance[],
      });
    }

    const seriesObj = studyObj.series.get(seriesInstanceUID);
    seriesObj.instances.push({
      sopInstanceUID,
      instanceNumber: instanceNumber == null ? null : Number(instanceNumber),
      url: instanceFilename,
      filename,
    });
  }

  const studies: DicomStudy[] = [];
  for (const study of studiesMap.values()) {
    const seriesArr = Array.from(study.series.values()).map((series: any) => {
      series.instances.sort((a: DicomInstance, b: DicomInstance) => {
        const na = Number.isFinite(a.instanceNumber) ? Number(a.instanceNumber) : Infinity;
        const nb = Number.isFinite(b.instanceNumber) ? Number(b.instanceNumber) : Infinity;
        return na - nb;
      });

      return {
        seriesInstanceUID: series.seriesInstanceUID,
        seriesDescription: series.seriesDescription,
        seriesNumber: series.seriesNumber,
        seriesModality: series.modality,
        seriesRelatedInstanceCount: String(series.instances.length),
        instances: series.instances,
      };
    });

    const modalities = Array.from(study.modalitiesInStudySet);
    const imageCount = seriesArr.reduce(
      (acc: number, item: DicomSeries) => acc + (Number(item.seriesRelatedInstanceCount) || 0),
      0
    );

    studies.push({
      studyInstanceUID: study.studyInstanceUID,
      patientName: study.patientName || '-',
      patientId: study.patientId || '-',
      studyDate: study.studyDate || '-',
      studyTime: study.studyTime || '',
      studyDescription: study.studyDescription || '-',
      accessionNumber: study.accessionNumber || '-',
      modalitiesInStudy: modalities.length ? modalities.join('\\') : '-',
      seriesCount: seriesArr.length,
      imageCount,
      series: seriesArr,
    });
  }

  return studies;
}

export function getDicomIndex(): DicomStudy[] {
  const manifest = readManifest();
  if (manifest) return manifest;

  const now = Date.now();
  if (fallbackCache && now - fallbackCache.createdAt < FALLBACK_CACHE_TTL_MS) {
    return fallbackCache.studies;
  }

  const studies = parseDicomDirectory();
  fallbackCache = { createdAt: now, studies };
  return studies;
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

export function getSeriesForStudy(studyUID: string): DicomSeries[] {
  const decodedUID = decodeURIComponent(studyUID);
  return getDicomIndex().find((study) => study.studyInstanceUID === decodedUID)?.series ?? [];
}

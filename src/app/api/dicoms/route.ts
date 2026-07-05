// app/api/dicoms/route.ts
import fs from 'fs';
import path from 'path';
import dcmjs from 'dcmjs';
import { NextResponse } from 'next/server';

/**
 * Server-side route: quét public/dicoms/*.dcm, parse bằng dcmjs,
 * trả về array of studies với đầy đủ metadata OHIF-like.
 *
 * WARNING: dcmjs parsing on many files can be slow. We do a simple
 * in-memory cache with TTL to reduce cost during dev.
 */

// --- Simple in-memory cache (module-scoped) ---
let cachedResult: any[] | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30 * 1000; // 30s cache (tune as needed)

// --- Helpers ---
const dicomDir = path.join(process.cwd(), 'public', 'dicoms');

function safeString(val: any, fallback = '–'): string {
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
  if (!pn) return '–';
  if (typeof pn === 'string') return pn;
  if (typeof pn === 'object') {
    if ('Alphabetic' in pn || 'Ideographic' in pn || 'Phonetic' in pn) {
      const parts = [pn.Alphabetic, pn.Ideographic, pn.Phonetic].filter(Boolean).map(String);
      return parts.length ? parts.join('\\') : '–';
    }
    if (Array.isArray(pn)) {
      return pn.map(formatPersonName).filter(Boolean).join('\\') || '–';
    }
    if ('Value' in pn && Array.isArray(pn.Value)) {
      return formatPersonName(pn.Value[0]);
    }
    const vals = Object.values(pn).filter(v => typeof v === 'string' || typeof v === 'number');
    if (vals.length) return vals.join('\\');
  }
  return '–';
}

function addModalities(set: Set<string>, modality: string | undefined) {
  if (!modality) return;
  const parts = String(modality).split(/\\|,/).map(s => s.trim()).filter(Boolean);
  parts.forEach(p => set.add(p));
}

export async function GET() {
  try {
    const now = Date.now();
    if (cachedResult && now - cachedAt < CACHE_TTL_MS) {
      return NextResponse.json(cachedResult);
    }

    if (!fs.existsSync(dicomDir)) {
      return NextResponse.json([], { status: 200 });
    }

    const fileNames = fs.readdirSync(dicomDir).filter(f => /\.dcm$/i.test(f));
    const studiesMap: Map<string, any> = new Map();

    for (const filename of fileNames) {
      const filePath = path.join(dicomDir, filename);
      let dataset: any = {};
      try {
        const buffer = fs.readFileSync(filePath);
        const uint8 = new Uint8Array(buffer);
        const dicomMessage = dcmjs.data.DicomMessage.readFile(uint8);
        dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomMessage.dict || {});
      } catch (err) {
        dataset = {};
      }

      const studyInstanceUID = dataset.StudyInstanceUID || `no-study-${filename}`;
      const seriesInstanceUID = dataset.SeriesInstanceUID || `no-series-${filename}`;
      const sopInstanceUID = dataset.SOPInstanceUID || filename;
      const instanceNumber = dataset.InstanceNumber ?? null;
      const patientName = formatPersonName(dataset.PatientName);
      const patientId = safeString(dataset.PatientID, '–');
      const studyDate = safeString(dataset.StudyDate, '–');
      const studyTime = safeString(dataset.StudyTime, '');
      const studyDescription = safeString(dataset.StudyDescription, '–');
      const accessionNumber = safeString(dataset.AccessionNumber, '–');
      const seriesDescription = safeString(dataset.SeriesDescription, '–');
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
      if ((!studyObj.patientName || studyObj.patientName === '–') && patientName && patientName !== '–') studyObj.patientName = patientName;
      if ((!studyObj.patientId || studyObj.patientId === '–') && patientId && patientId !== '–') studyObj.patientId = patientId;
      if ((!studyObj.studyDescription || studyObj.studyDescription === '–') && studyDescription && studyDescription !== '–') studyObj.studyDescription = studyDescription;
      if ((!studyObj.accessionNumber || studyObj.accessionNumber === '–') && accessionNumber && accessionNumber !== '–') studyObj.accessionNumber = accessionNumber;
      if ((!studyObj.studyDate || studyObj.studyDate === '–') && studyDate && studyDate !== '–') studyObj.studyDate = studyDate;

      addModalities(studyObj.modalitiesInStudySet, modality);

      if (!studyObj.series.has(seriesInstanceUID)) {
        studyObj.series.set(seriesInstanceUID, {
          seriesInstanceUID,
          seriesDescription,
          seriesNumber,
          modality,
          instances: [] as any[],
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

    // Convert maps/sets to plain arrays & compute counts
    const studies: any[] = [];
    for (const [_uid, s] of studiesMap) {
      const seriesArr = Array.from(s.series.values()).map((ser: any) => {
        ser.instances.sort((a: any, b: any) => {
          const na = Number.isFinite(a.instanceNumber) ? a.instanceNumber : Infinity;
          const nb = Number.isFinite(b.instanceNumber) ? b.instanceNumber : Infinity;
          return na - nb;
        });
        return {
          seriesInstanceUID: ser.seriesInstanceUID,
          seriesDescription: ser.seriesDescription,
          seriesNumber: ser.seriesNumber,
          seriesModality: ser.modality,
          seriesRelatedInstanceCount: String(ser.instances.length),
          instances: ser.instances,
        };
      });

      const modalities = Array.from(s.modalitiesInStudySet);
      const imageCount = seriesArr.reduce((acc: number, it: any) => acc + (Number(it.seriesRelatedInstanceCount) || 0), 0);

      studies.push({
        studyInstanceUID: s.studyInstanceUID,
        patientName: s.patientName || '–',
        patientId: s.patientId || '–',
        studyDate: s.studyDate || '–',
        studyTime: s.studyTime || '',
        studyDescription: s.studyDescription || '–',
        accessionNumber: s.accessionNumber || '–',
        modalitiesInStudy: modalities.length ? modalities.join('\\') : '–',
        seriesCount: seriesArr.length,
        imageCount,
        series: seriesArr,
      });
    }

    // --- DEBUG LOGS: print counts and a preview ---
    if (studies.length > 0) {
      const firstSeries = studies[0].series?.[0];
      if (firstSeries && firstSeries.instances && firstSeries.instances.length) {
      }
    } else {
    }

    // Cache and return
    cachedResult = studies;
    cachedAt = Date.now();

    return NextResponse.json(studies, { status: 200 });
  } catch (err) {
    return NextResponse.json({ error: 'Internal' }, { status: 500 });
  }
}

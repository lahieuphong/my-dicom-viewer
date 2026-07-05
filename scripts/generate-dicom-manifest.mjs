#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dcmjs from 'dcmjs';

const rootDir = process.cwd();
const dicomDir = path.join(rootDir, 'public', 'dicoms');
const outputPath = path.join(rootDir, 'public', 'dicom-manifest.json');

function safeString(value, fallback = '-') {
  if (value == null) return fallback;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value);
    return text === '' ? fallback : text;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function formatPersonName(personName) {
  if (!personName) return '-';
  if (typeof personName === 'string') return personName;

  if (Array.isArray(personName)) {
    return personName.map(formatPersonName).filter(Boolean).join('\\') || '-';
  }

  if (typeof personName === 'object') {
    if ('Alphabetic' in personName || 'Ideographic' in personName || 'Phonetic' in personName) {
      const parts = [personName.Alphabetic, personName.Ideographic, personName.Phonetic]
        .filter(Boolean)
        .map(String);
      return parts.length ? parts.join('\\') : '-';
    }

    if ('Value' in personName && Array.isArray(personName.Value)) {
      return formatPersonName(personName.Value[0]);
    }

    const values = Object.values(personName).filter(
      (value) => typeof value === 'string' || typeof value === 'number'
    );
    if (values.length) return values.join('\\');
  }

  return '-';
}

function addModality(set, modality) {
  if (!modality) return;
  String(modality)
    .split(/\\|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => set.add(item));
}

function parseDataset(filename) {
  const filePath = path.join(dicomDir, filename);

  try {
    const buffer = fs.readFileSync(filePath);
    const dicomMessage = dcmjs.data.DicomMessage.readFile(new Uint8Array(buffer));
    return dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomMessage.dict || {});
  } catch {
    return {};
  }
}

function buildManifest() {
  if (!fs.existsSync(dicomDir)) {
    return [];
  }

  const filenames = fs
    .readdirSync(dicomDir)
    .filter((filename) => /\.dcm$/i.test(filename))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const studiesMap = new Map();

  for (const filename of filenames) {
    const dataset = parseDataset(filename);
    const studyInstanceUID = safeString(dataset.StudyInstanceUID, `no-study-${filename}`);
    const seriesInstanceUID = safeString(dataset.SeriesInstanceUID, `no-series-${filename}`);
    const modality = safeString(dataset.Modality, '');

    if (!studiesMap.has(studyInstanceUID)) {
      studiesMap.set(studyInstanceUID, {
        studyInstanceUID,
        patientName: formatPersonName(dataset.PatientName),
        patientId: safeString(dataset.PatientID),
        studyDate: safeString(dataset.StudyDate),
        studyTime: safeString(dataset.StudyTime, ''),
        studyDescription: safeString(dataset.StudyDescription),
        accessionNumber: safeString(dataset.AccessionNumber),
        modalitiesInStudySet: new Set(),
        series: new Map(),
      });
    }

    const study = studiesMap.get(studyInstanceUID);
    addModality(study.modalitiesInStudySet, modality);

    if (!study.series.has(seriesInstanceUID)) {
      study.series.set(seriesInstanceUID, {
        seriesInstanceUID,
        seriesDescription: safeString(dataset.SeriesDescription),
        seriesNumber: safeString(dataset.SeriesNumber, ''),
        seriesModality: modality,
        instances: [],
      });
    }

    study.series.get(seriesInstanceUID).instances.push({
      sopInstanceUID: safeString(dataset.SOPInstanceUID, filename),
      instanceNumber: dataset.InstanceNumber == null ? null : Number(dataset.InstanceNumber),
      url: `/dicoms/${filename}`,
      filename,
    });
  }

  return Array.from(studiesMap.values()).map((study) => {
    const series = Array.from(study.series.values()).map((item) => {
      item.instances.sort((a, b) => {
        const left = Number.isFinite(a.instanceNumber) ? Number(a.instanceNumber) : Infinity;
        const right = Number.isFinite(b.instanceNumber) ? Number(b.instanceNumber) : Infinity;
        return left - right;
      });

      return {
        seriesInstanceUID: item.seriesInstanceUID,
        seriesDescription: item.seriesDescription,
        seriesNumber: item.seriesNumber,
        seriesModality: item.seriesModality,
        seriesRelatedInstanceCount: String(item.instances.length),
        instances: item.instances,
      };
    });

    const imageCount = series.reduce(
      (total, item) => total + (Number(item.seriesRelatedInstanceCount) || 0),
      0
    );
    const modalities = Array.from(study.modalitiesInStudySet);

    return {
      studyInstanceUID: study.studyInstanceUID,
      patientName: study.patientName,
      patientId: study.patientId,
      studyDate: study.studyDate,
      studyTime: study.studyTime,
      studyDescription: study.studyDescription,
      accessionNumber: study.accessionNumber,
      modalitiesInStudy: modalities.length ? modalities.join('\\') : '-',
      seriesCount: series.length,
      imageCount,
      series,
    };
  });
}

const studies = buildManifest();
const instanceCount = studies.reduce((total, study) => total + study.imageCount, 0);
const payload = {
  generatedAt: new Date().toISOString(),
  source: 'public/dicoms',
  studyCount: studies.length,
  instanceCount,
  studies,
};

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Generated public/dicom-manifest.json (${studies.length} studies, ${instanceCount} instances).`);

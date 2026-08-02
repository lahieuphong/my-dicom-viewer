'use client';

import { metaData } from '@cornerstonejs/core';

import {
  getCornerstoneSrRuntime,
  SUPPORTED_SR_TOOL_NAMES,
} from './adapterRuntime';

export type DicomCode = {
  CodeValue: string;
  CodingSchemeDesignator: string;
  CodeMeaning: string;
};

export interface SRMeasurement {
  uid: string;
  label?: string;
  annotation: any;
}

export interface CreateSRRequest {
  studyInstanceUID: string;
  measurements: SRMeasurement[];
  seriesDescription: string;
  seriesNumber: number;
  instanceNumber?: number;
}

export interface GeneratedStructuredReport {
  dataset: any;
  exportedMeasurementUIDs: string[];
  sourceImageIds: string[];
  sourceSeriesInstanceUIDs: string[];
  measurementGroupCount: number;
}

const FREE_TEXT_CODE_VALUE = 'CORNERSTONEFREETEXT';
const FREE_TEXT_SCHEME = 'CORNERSTONEJS';
const LENGTH_CONCEPTS = new Set([
  'length',
  'long axis',
  'short axis',
  'perimeter',
  'radius',
]);
const AREA_CONCEPTS = new Set(['area']);

function cloneAnnotation(annotation: any): any {
  try {
    return structuredClone(annotation);
  } catch {
    return JSON.parse(JSON.stringify(annotation));
  }
}

function asSequence(value: any): any[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function countMeasurementGroups(value: any): number {
  if (!value || typeof value !== 'object') return 0;

  let count = 0;
  const concept = asSequence(value.ConceptNameCodeSequence)[0];
  if (concept?.CodeMeaning === 'Measurement Group') {
    count += 1;
  }

  for (const item of asSequence(value.ContentSequence)) {
    count += countMeasurementGroups(item);
  }

  return count;
}

function createFreeTextCode(label: string): DicomCode {
  return {
    CodeValue: FREE_TEXT_CODE_VALUE,
    CodingSchemeDesignator: FREE_TEXT_SCHEME,
    CodeMeaning: label.slice(0, 64),
  };
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function firstDefined<T>(...values: T[]): T | undefined {
  return values.find((value) => value !== null && typeof value !== 'undefined');
}

function padNumber(value: unknown, width: number): string {
  return String(Number(value) || 0).padStart(width, '0');
}

function normalizeDicomDate(value: any): string | undefined {
  if (typeof value === 'string') {
    const normalized = value.replace(/[^0-9]/g, '');
    return normalized || undefined;
  }
  if (!value || typeof value !== 'object' || !value.year) return undefined;

  return `${padNumber(value.year, 4)}${padNumber(
    value.month,
    2
  )}${padNumber(value.day, 2)}`;
}

function normalizeDicomTime(value: any): string | undefined {
  if (typeof value === 'string') {
    const normalized = value.replace(/:/g, '');
    return normalized || undefined;
  }
  if (!value || typeof value !== 'object') return undefined;

  return `${padNumber(value.hours, 2)}${padNumber(
    value.minutes,
    2
  )}${padNumber(value.seconds, 2)}`;
}

function normalizePersonName(value: any): string | undefined {
  if (typeof value === 'string') return value || undefined;
  if (!value || typeof value !== 'object') return undefined;

  const groups = [
    value.Alphabetic ?? value.alphabetic,
    value.Ideographic ?? value.ideographic,
    value.Phonetic ?? value.phonetic,
  ].map((part) => (typeof part === 'string' ? part : ''));
  while (groups.length && !groups[groups.length - 1]) groups.pop();
  return groups.join('=') || undefined;
}

function assignDefined(
  target: Record<string, any>,
  key: string,
  value: unknown
): void {
  if (value !== null && typeof value !== 'undefined' && value !== '') {
    target[key] = value;
  }
}

/**
 * dicom-image-loader's synthetic `instance` module omits patientModule and
 * generalStudyModule. dcmjs copies patient/study tags from `instance`, so
 * build a normalized allow-list here before generating the report. Parsed
 * date/time objects cannot be passed directly to dcmjs's DICOM writer.
 */
const srMetadataProvider = {
  get(type: string, imageId: string): any {
    const value = metaData.get(type, imageId);
    if (type === 'frameNumber') {
      const direct = Number(value);
      if (Number.isInteger(direct) && direct >= 1) return direct;

      /**
       * Both WADO-URI `frame=` and WADO-RS `/frames/` use DICOM's one-based
       * frame number. Some dicom-image-loader providers do not expose a
       * separate frameNumber metadata module, so retain that exact reference.
       */
      const match = String(imageId).match(
        /(?:[?&]frame=|\/frames\/)(\d+)/i
      );
      const fromImageId = Number(match?.[1]);
      return Number.isInteger(fromImageId) && fromImageId >= 1
        ? fromImageId
        : undefined;
    }
    if (type !== 'instance') return value;

    const base = value ?? {};
    const patient = metaData.get('patientModule', imageId) ?? {};
    const patientStudy =
      metaData.get('patientStudyModule', imageId) ?? {};
    const generalStudy =
      metaData.get('generalStudyModule', imageId) ?? {};
    const generalSeries =
      metaData.get('generalSeriesModule', imageId) ?? {};
    const sopCommon = metaData.get('sopCommonModule', imageId) ?? {};
    const multiframe = metaData.get('multiframeModule', imageId) ?? {};
    const instance: Record<string, any> = {};

    assignDefined(
      instance,
      'StudyInstanceUID',
      firstDefined(
        base.StudyInstanceUID,
        generalSeries.studyInstanceUID
      )
    );
    assignDefined(
      instance,
      'SeriesInstanceUID',
      firstDefined(
        base.SeriesInstanceUID,
        generalSeries.seriesInstanceUID
      )
    );
    assignDefined(
      instance,
      'SeriesNumber',
      firstDefined(base.SeriesNumber, generalSeries.seriesNumber)
    );
    assignDefined(
      instance,
      'SeriesDescription',
      firstDefined(
        base.SeriesDescription,
        generalSeries.seriesDescription
      )
    );
    assignDefined(
      instance,
      'Modality',
      firstDefined(base.Modality, generalSeries.modality)
    );
    assignDefined(
      instance,
      'StudyDescription',
      firstDefined(
        base.StudyDescription,
        generalStudy.studyDescription
      )
    );
    assignDefined(
      instance,
      'AccessionNumber',
      firstDefined(
        base.AccessionNumber,
        generalStudy.accessionNumber
      )
    );
    assignDefined(
      instance,
      'PatientID',
      firstDefined(base.PatientID, patient.patientID)
    );
    assignDefined(
      instance,
      'PatientName',
      normalizePersonName(
        firstDefined(base.PatientName, patient.patientName)
      )
    );
    assignDefined(
      instance,
      'PatientSex',
      firstDefined(
        base.PatientSex,
        patient.patientSex,
        patientStudy.patientSex
      )
    );
    assignDefined(
      instance,
      'PatientBirthDate',
      normalizeDicomDate(
        firstDefined(
          base.PatientBirthDate,
          patient.patientBirthDate,
          patientStudy.patientBirthDate
        )
      )
    );
    assignDefined(
      instance,
      'PatientBirthTime',
      normalizeDicomTime(
        firstDefined(
          base.PatientBirthTime,
          patient.patientBirthTime,
          patientStudy.patientBirthTime
        )
      )
    );
    assignDefined(
      instance,
      'IssuerOfPatientID',
      firstDefined(
        base.IssuerOfPatientID,
        patient.issuerOfPatientID
      )
    );
    assignDefined(
      instance,
      'PatientIdentityRemoved',
      firstDefined(
        base.PatientIdentityRemoved,
        patient.patientIdentityRemoved
      )
    );

    const patientAge = firstDefined(
      base.PatientAge,
      patientStudy.patientAge
    );
    if (
      typeof patientAge === 'string' &&
      /^\d{3}[DWMY]$/.test(patientAge)
    ) {
      instance.PatientAge = patientAge;
    }

    assignDefined(
      instance,
      'StudyDate',
      normalizeDicomDate(
        firstDefined(base.StudyDate, generalStudy.studyDate)
      )
    );
    assignDefined(
      instance,
      'StudyTime',
      normalizeDicomTime(
        firstDefined(base.StudyTime, generalStudy.studyTime)
      )
    );
    assignDefined(
      instance,
      'StudyID',
      firstDefined(
        base.StudyID,
        generalStudy.studyID,
        generalStudy.studyId
      )
    );
    assignDefined(
      instance,
      'ReferringPhysicianName',
      normalizePersonName(
        firstDefined(
          base.ReferringPhysicianName,
          generalStudy.referringPhysicianName
        )
      )
    );
    assignDefined(
      instance,
      'BodyPartExamined',
      firstDefined(
        base.BodyPartExamined,
        generalStudy.bodyPartExamined,
        generalSeries.bodyPartExamined
      )
    );
    assignDefined(
      instance,
      'TimezoneOffsetFromUTC',
      firstDefined(
        base.TimezoneOffsetFromUTC,
        generalStudy.timezoneOffsetFromUTC,
        generalSeries.timezoneOffsetFromUTC
      )
    );
    assignDefined(
      instance,
      'SeriesDate',
      normalizeDicomDate(
        firstDefined(base.SeriesDate, generalSeries.seriesDate)
      )
    );
    assignDefined(
      instance,
      'SeriesTime',
      normalizeDicomTime(
        firstDefined(base.SeriesTime, generalSeries.seriesTime)
      )
    );
    assignDefined(
      instance,
      'NumberOfFrames',
      firstDefined(base.NumberOfFrames, multiframe.numberOfFrames)
    );
    assignDefined(
      instance,
      'SOPClassUID',
      firstDefined(base.SOPClassUID, sopCommon.sopClassUID)
    );
    assignDefined(
      instance,
      'SOPInstanceUID',
      firstDefined(base.SOPInstanceUID, sopCommon.sopInstanceUID)
    );

    return instance;
  },
};

function toPoint3(value: any): [number, number, number] | null {
  if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return null;

  const indexed = value as any;
  const x = Number(indexed[0]);
  const y = Number(indexed[1]);
  const z = Number(indexed[2] ?? 0);
  return [x, y, z].every(Number.isFinite) ? [x, y, z] : null;
}

function distance3(first: any, second: any): number {
  const a = toPoint3(first);
  const b = toPoint3(second);
  if (!a || !b) return Number.NaN;

  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function polylineLength(points: any[], closed: boolean): number {
  if (!Array.isArray(points) || points.length < 2) return Number.NaN;

  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const segment = distance3(points[index - 1], points[index]);
    if (!Number.isFinite(segment)) return Number.NaN;
    total += segment;
  }

  if (closed) {
    const closingSegment = distance3(points[points.length - 1], points[0]);
    if (!Number.isFinite(closingSegment)) return Number.NaN;
    total += closingSegment;
  }

  return total;
}

/**
 * Area of a planar polygon embedded in 3D. Cornerstone stores annotation
 * handles in patient/world millimetres, so the result is square millimetres.
 */
function polygonArea3(points: any[]): number {
  if (!Array.isArray(points) || points.length < 3) return Number.NaN;

  const parsed = points.map(toPoint3);
  if (parsed.some((point) => !point)) return Number.NaN;

  let x = 0;
  let y = 0;
  let z = 0;
  for (let index = 0; index < parsed.length; index += 1) {
    const current = parsed[index]!;
    const next = parsed[(index + 1) % parsed.length]!;
    x += current[1] * next[2] - current[2] * next[1];
    y += current[2] * next[0] - current[0] * next[2];
    z += current[0] * next[1] - current[1] * next[0];
  }

  return Math.hypot(x, y, z) / 2;
}

function angleDegrees(first: any, vertex: any, last: any): number {
  const a = toPoint3(first);
  const b = toPoint3(vertex);
  const c = toPoint3(last);
  if (!a || !b || !c) return Number.NaN;

  const firstVector = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const secondVector = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const firstLength = Math.hypot(...firstVector);
  const secondLength = Math.hypot(...secondVector);
  if (!firstLength || !secondLength) return Number.NaN;

  const cosine = Math.max(
    -1,
    Math.min(
      1,
      firstVector.reduce(
        (sum, value, index) => sum + value * secondVector[index],
        0
      ) /
        (firstLength * secondLength)
    )
  );
  return (Math.acos(cosine) * 180) / Math.PI;
}

function requireFiniteStat(
  stats: Record<string, any>,
  key: string,
  fallback: number,
  annotationUID: string
): number {
  const current = Number(stats[key]);
  const value = Number.isFinite(current) ? current : fallback;
  if (!Number.isFinite(value)) {
    throw new Error(
      `Measurement ${annotationUID} has no valid ${key} value.`
    );
  }
  stats[key] = value;
  return value;
}

function hasPhysicalPixelSpacing(imageId: string): boolean {
  const imagePlane = metaData.get('imagePlaneModule', imageId) ?? {};
  const rowPixelSpacing = Number(imagePlane.rowPixelSpacing);
  const columnPixelSpacing = Number(imagePlane.columnPixelSpacing);
  return (
    Number.isFinite(rowPixelSpacing) &&
    rowPixelSpacing > 0 &&
    Number.isFinite(columnPixelSpacing) &&
    columnPixelSpacing > 0
  );
}

function normalizeLengthUnit(
  value: unknown,
  referencedImageId: string
): 'mm' | 'px' {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized.startsWith('px')) return 'px';
  if (normalized.startsWith('mm')) return 'mm';
  return hasPhysicalPixelSpacing(referencedImageId) ? 'mm' : 'px';
}

function normalizeAreaUnit(
  value: unknown,
  referencedImageId: string
): 'mm2' | 'px2' {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized.startsWith('px')) return 'px2';
  if (normalized.startsWith('mm')) return 'mm2';
  return hasPhysicalPixelSpacing(referencedImageId) ? 'mm2' : 'px2';
}

/**
 * Cornerstone's current SR adapters omit units for several tool types and
 * require perimeter/radius values that normal cachedStats do not always
 * contain. Complete those values on the cloned export snapshot only.
 */
function normalizeCachedStats(
  annotation: any,
  referencedImageId: string,
  toolName: string,
  annotationUID: string
): void {
  const cachedStats = annotation?.data?.cachedStats;
  if (!cachedStats || typeof cachedStats !== 'object') {
    annotation.data.cachedStats = {};
  }

  const expectedKey = `imageId:${referencedImageId}`;
  const normalizedCachedStats = annotation.data.cachedStats;
  if (!normalizedCachedStats[expectedKey]) {
    const firstStats = Object.values(normalizedCachedStats)[0];
    normalizedCachedStats[expectedKey] =
      firstStats && typeof firstStats === 'object' ? { ...firstStats } : {};
  }
  const stats = normalizedCachedStats[expectedKey] as Record<string, any>;
  const handlePoints = annotation?.data?.handles?.points ?? [];
  const contourPoints = annotation?.data?.contour?.polyline ?? [];

  switch (toolName) {
    case 'Length': {
      requireFiniteStat(
        stats,
        'length',
        distance3(handlePoints[0], handlePoints[1]),
        annotationUID
      );
      stats.unit = normalizeLengthUnit(stats.unit, referencedImageId);
      break;
    }
    case 'Bidirectional': {
      const firstAxis = distance3(handlePoints[0], handlePoints[1]);
      const secondAxis = distance3(handlePoints[2], handlePoints[3]);
      requireFiniteStat(
        stats,
        'length',
        Math.max(firstAxis, secondAxis),
        annotationUID
      );
      requireFiniteStat(
        stats,
        'width',
        Math.min(firstAxis, secondAxis),
        annotationUID
      );
      stats.unit = normalizeLengthUnit(stats.unit, referencedImageId);
      break;
    }
    case 'CircleROI': {
      const radius = requireFiniteStat(
        stats,
        'radius',
        distance3(handlePoints[0], handlePoints[1]),
        annotationUID
      );
      requireFiniteStat(
        stats,
        'perimeter',
        2 * Math.PI * radius,
        annotationUID
      );
      requireFiniteStat(
        stats,
        'area',
        Math.PI * radius * radius,
        annotationUID
      );
      stats.unit = normalizeLengthUnit(
        stats.unit ?? stats.radiusUnit ?? stats.areaUnit,
        referencedImageId
      );
      stats.areaUnit = normalizeAreaUnit(
        stats.areaUnit ?? stats.unit,
        referencedImageId
      );
      break;
    }
    case 'EllipticalROI': {
      const firstDiameter = distance3(handlePoints[0], handlePoints[1]);
      const secondDiameter = distance3(handlePoints[2], handlePoints[3]);
      requireFiniteStat(
        stats,
        'area',
        (Math.PI * firstDiameter * secondDiameter) / 4,
        annotationUID
      );
      stats.areaUnit = normalizeAreaUnit(
        stats.areaUnit,
        referencedImageId
      );
      break;
    }
    case 'RectangleROI': {
      const orderedCorners = [
        handlePoints[0],
        handlePoints[1],
        handlePoints[3],
        handlePoints[2],
      ];
      requireFiniteStat(
        stats,
        'perimeter',
        polylineLength(orderedCorners, true),
        annotationUID
      );
      requireFiniteStat(
        stats,
        'area',
        polygonArea3(orderedCorners),
        annotationUID
      );
      stats.unit = normalizeLengthUnit(
        stats.unit ?? stats.areaUnit,
        referencedImageId
      );
      stats.areaUnit = normalizeAreaUnit(
        stats.areaUnit ?? stats.unit,
        referencedImageId
      );
      break;
    }
    case 'PlanarFreehandROI':
    case 'SplineROI':
    case 'LivewireContour': {
      const closed = annotation?.data?.contour?.closed !== false;
      if (!closed) {
        throw new Error(
          `Measurement ${annotationUID} must be a closed ${toolName} contour before it can be exported to DICOM SR.`
        );
      }
      requireFiniteStat(
        stats,
        'perimeter',
        polylineLength(contourPoints, closed),
        annotationUID
      );
      requireFiniteStat(
        stats,
        'area',
        polygonArea3(contourPoints),
        annotationUID
      );
      stats.unit = normalizeLengthUnit(
        stats.unit ?? stats.areaUnit,
        referencedImageId
      );
      stats.areaUnit = normalizeAreaUnit(
        stats.areaUnit ?? stats.unit,
        referencedImageId
      );
      break;
    }
    case 'Angle': {
      requireFiniteStat(
        stats,
        'angle',
        angleDegrees(handlePoints[0], handlePoints[1], handlePoints[2]),
        annotationUID
      );
      break;
    }
  }
}

function normalizeAndValidateNumericContent(value: any): void {
  if (!value || typeof value !== 'object') return;

  const concept = String(
    asSequence(value.ConceptNameCodeSequence)[0]?.CodeMeaning ?? ''
  )
    .trim()
    .toLowerCase();

  /**
   * dcmjs 0.43 emits Point/ArrowAnnotate as a NUM without a measured value and
   * puts two points into a POINT SCOORD. Represent it as the qualitative
   * spatial content item it actually is: one arrow tip plus its IMAGE child.
   * Cornerstone's reader supports this direct SCOORD form and reconstructs a
   * display tail on hydration.
   */
  if (
    value.ValueType === 'NUM' &&
    concept === 'center' &&
    !asSequence(value.MeasuredValueSequence)[0]
  ) {
    const spatialItem = asSequence(value.ContentSequence).find(
      (item) =>
        item?.ValueType === 'SCOORD' || item?.ValueType === 'SCOORD3D'
    );
    if (!spatialItem) {
      throw new Error('Generated SR point annotation has no spatial content.');
    }

    const coordinateCount = spatialItem.ValueType === 'SCOORD3D' ? 3 : 2;
    const graphicData = Array.from(spatialItem.GraphicData ?? []).slice(
      0,
      coordinateCount
    );
    if (
      graphicData.length !== coordinateCount ||
      graphicData.some((coordinate) => !Number.isFinite(Number(coordinate)))
    ) {
      throw new Error(
        'Generated SR point annotation has invalid coordinates.'
      );
    }

    value.ValueType = spatialItem.ValueType;
    value.GraphicType = 'POINT';
    value.GraphicData = graphicData;
    value.ContentSequence = spatialItem.ContentSequence;
    if (spatialItem.ReferencedFrameOfReferenceUID) {
      value.ReferencedFrameOfReferenceUID =
        spatialItem.ReferencedFrameOfReferenceUID;
    }
    delete value.MeasuredValueSequence;
  }

  if (value.ValueType === 'NUM') {
    const measuredValue = asSequence(value.MeasuredValueSequence)[0];
    const numericValue = Number(measuredValue?.NumericValue);

    if (!Number.isFinite(numericValue)) {
      throw new Error(
        `Generated SR has an invalid numeric value for ${concept || 'a measurement'}.`
      );
    }
    // DICOM DS is limited to 16 characters. Keep ample measurement precision
    // while preventing dcmjs from silently truncating longer JS decimals.
    measuredValue.NumericValue = Number(numericValue.toPrecision(12));

    if (AREA_CONCEPTS.has(concept)) {
      const conceptCode = asSequence(
        value.ConceptNameCodeSequence
      )[0];
      if (conceptCode?.CodeValue === 'G-D7FE') {
        // dcmjs uses the SRT Length code for Ellipse AREA.
        conceptCode.CodeValue = 'G-A166';
      }
    }

    const unit = asSequence(
      measuredValue?.MeasurementUnitsCodeSequence
    )[0];
    if (!unit?.CodeValue || !unit?.CodingSchemeDesignator) {
      throw new Error(
        `Generated SR has no measurement unit for ${concept || 'a numeric value'}.`
      );
    }
    if (
      LENGTH_CONCEPTS.has(concept) &&
      !['mm', '1'].includes(String(unit.CodeValue))
    ) {
      throw new Error(
        `Generated SR has an unsupported length unit for ${concept}.`
      );
    }
    if (
      AREA_CONCEPTS.has(concept) &&
      !['mm2', '1'].includes(String(unit.CodeValue))
    ) {
      throw new Error(
        `Generated SR has an unsupported area unit for ${concept}.`
      );
    }
  }

  for (const item of asSequence(value.ContentSequence)) {
    normalizeAndValidateNumericContent(item);
  }
}

function assertSourceMetadata(
  referencedImageId: string,
  studyInstanceUID: string,
  annotationUID: string
): {
  sourceSeriesInstanceUID: string;
} {
  const sopCommon = metaData.get('sopCommonModule', referencedImageId) as
    | { sopClassUID?: string; sopInstanceUID?: string }
    | undefined;
  const instance = metaData.get('instance', referencedImageId) as
    | {
        StudyInstanceUID?: string;
        SeriesInstanceUID?: string;
      }
    | undefined;

  if (!sopCommon?.sopClassUID || !sopCommon.sopInstanceUID) {
    throw new Error(
      `Measurement ${annotationUID} is missing referenced SOP metadata.`
    );
  }

  if (!instance?.StudyInstanceUID || !instance.SeriesInstanceUID) {
    throw new Error(
      `Measurement ${annotationUID} is missing study/series metadata.`
    );
  }

  if (instance.StudyInstanceUID !== studyInstanceUID) {
    throw new Error(
      `Measurement ${annotationUID} belongs to a different study.`
    );
  }

  const numberOfFrames = Number(
    srMetadataProvider.get('instance', referencedImageId)
      ?.NumberOfFrames
  );
  if (Number.isFinite(numberOfFrames) && numberOfFrames > 1) {
    const frameNumber = srMetadataProvider.get(
      'frameNumber',
      referencedImageId
    );
    if (!Number.isInteger(frameNumber) || frameNumber < 1) {
      throw new Error(
        `Measurement ${annotationUID} is missing its referenced frame number.`
      );
    }
  }

  return {
    sourceSeriesInstanceUID: instance.SeriesInstanceUID,
  };
}

function validateGeneratedDataset(
  dataset: any,
  request: CreateSRRequest,
  expectedMeasurementCount: number
): number {
  if (!dataset?.SOPClassUID) {
    throw new Error('Generated report has no SOP Class UID.');
  }
  if (!dataset?.SOPInstanceUID || !dataset?.SeriesInstanceUID) {
    throw new Error('Generated report has no SOP/Series Instance UID.');
  }
  if (dataset.StudyInstanceUID !== request.studyInstanceUID) {
    throw new Error('Generated report does not belong to the active study.');
  }

  const template = asSequence(dataset.ContentTemplateSequence)[0];
  if (String(template?.TemplateIdentifier ?? '') !== '1500') {
    throw new Error('Generated report is not a DICOM TID 1500 report.');
  }

  const groupCount = countMeasurementGroups(dataset);
  if (groupCount !== expectedMeasurementCount) {
    throw new Error(
      `Generated report contains ${groupCount}/${expectedMeasurementCount} measurement groups.`
    );
  }

  return groupCount;
}

/**
 * OHIF-compatible SR generation:
 * Measurement-service snapshots are intersected with live Cornerstone
 * annotations by UID before this function is called.  Each tool is then
 * serialized by the official Cornerstone3D TID300/TID1501/TID1500 adapters.
 */
export async function buildStructuredReport(
  request: CreateSRRequest
): Promise<GeneratedStructuredReport> {
  if (!request.studyInstanceUID) {
    throw new Error('Study Instance UID is required.');
  }
  if (!request.measurements.length) {
    throw new Error('There are no measurements to export.');
  }

  const { MeasurementReport } = await getCornerstoneSrRuntime();
  const toolState: Record<string, Record<string, { data: any[] }>> = {};
  const exportedMeasurementUIDs: string[] = [];
  const sourceImageIds = new Set<string>();
  const sourceSeriesInstanceUIDs = new Set<string>();

  for (const measurement of request.measurements) {
    const annotation = cloneAnnotation(measurement.annotation);
    const annotationUID = String(
      annotation?.annotationUID ?? measurement.uid ?? ''
    );
    const toolName = String(
      annotation?.metadata?.toolName ?? annotation?.toolName ?? ''
    );
    const referencedImageId = String(
      annotation?.metadata?.referencedImageId ??
        annotation?.metadata?.imageId ??
        ''
    );

    if (!annotationUID || annotationUID !== measurement.uid) {
      throw new Error('Measurement and annotation identifiers do not match.');
    }
    if (!SUPPORTED_SR_TOOL_NAMES.has(toolName)) {
      throw new Error(`Tool ${toolName || 'Unknown'} cannot be exported to SR.`);
    }
    if (!referencedImageId) {
      throw new Error(
        `Measurement ${annotationUID} has no referenced image.`
      );
    }
    if (!MeasurementReport.measurementAdapterByToolType?.has(toolName)) {
      throw new Error(`No DICOM SR adapter is registered for ${toolName}.`);
    }

    const { sourceSeriesInstanceUID } = assertSourceMetadata(
      referencedImageId,
      request.studyInstanceUID,
      annotationUID
    );

    annotation.metadata = {
      ...(annotation.metadata ?? {}),
      toolName,
      referencedImageId,
    };
    annotation.data = {
      ...(annotation.data ?? {}),
    };

    const label = firstNonEmptyString(
      measurement.label,
      annotation.metadata?.label,
      annotation.data?.label,
      toolName === 'ArrowAnnotate' ? annotation.data?.text : undefined
    );
    if (label) {
      annotation.data.label = label;
      annotation.metadata.label = label;

      const freeTextCode = createFreeTextCode(label);
      if (toolName === 'ArrowAnnotate') {
        annotation.data.text = label;
        annotation.finding = freeTextCode;
      } else {
        annotation.findingSites = [
          ...(Array.isArray(annotation.findingSites)
            ? annotation.findingSites
            : []),
          freeTextCode,
        ];
      }
    }

    normalizeCachedStats(
      annotation,
      referencedImageId,
      toolName,
      annotationUID
    );

    toolState[referencedImageId] ??= {};
    toolState[referencedImageId][toolName] ??= { data: [] };
    toolState[referencedImageId][toolName].data.push(annotation);

    exportedMeasurementUIDs.push(annotationUID);
    sourceImageIds.add(referencedImageId);
    sourceSeriesInstanceUIDs.add(sourceSeriesInstanceUID);
  }

  const report = MeasurementReport.generateReport(
    toolState,
    srMetadataProvider,
    {
      SeriesDescription:
        request.seriesDescription.trim() || 'Measurement Report',
      SeriesNumber: request.seriesNumber,
      InstanceNumber: request.instanceNumber ?? 1,
    }
  );
  const dataset = report?.dataset;

  if (!dataset) {
    throw new Error('Cornerstone failed to generate a DICOM SR dataset.');
  }
  if (typeof dataset.SpecificCharacterSet === 'undefined') {
    dataset.SpecificCharacterSet = 'ISO_IR 192';
  }
  normalizeAndValidateNumericContent(dataset);

  const measurementGroupCount = validateGeneratedDataset(
    dataset,
    request,
    exportedMeasurementUIDs.length
  );

  return {
    dataset,
    exportedMeasurementUIDs,
    sourceImageIds: Array.from(sourceImageIds),
    sourceSeriesInstanceUIDs: Array.from(sourceSeriesInstanceUIDs),
    measurementGroupCount,
  };
}

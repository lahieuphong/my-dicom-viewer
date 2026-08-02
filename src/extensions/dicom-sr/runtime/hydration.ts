'use client';

import { metaData } from '@cornerstonejs/core';
import {
  SplineROITool,
  ToolGroupManager,
} from '@cornerstonejs/tools';

import { TOOL_GROUP } from '@/constants/toolgroup';
import type { AnnotationMeasurement } from '@/hooks/useMeasurements';
import { findMatchingImageIdIndex } from '@/lib/cornerstone/helpers';

import { getCornerstoneSrRuntime } from './adapterRuntime';

const DOMAIN_TYPE_BY_TOOL_NAME: Record<
  string,
  AnnotationMeasurement['type']
> = {
  Length: 'length',
  Bidirectional: 'bidirectional',
  ArrowAnnotate: 'arrowAnnotate',
  EllipticalROI: 'ellipticalROI',
  RectangleROI: 'rectangleROI',
  CircleROI: 'circleROI',
  SplineROI: 'splineROI',
  Angle: 'angle',
};

function readCodeMeaning(code: any): string {
  const value = Array.isArray(code) ? code[0] : code;
  return typeof value?.CodeMeaning === 'string' ? value.CodeMeaning : '';
}

function asSequence(value: any): any[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getMeasurementGroups(dataset: any): any[] {
  const imagingMeasurements = asSequence(dataset?.ContentSequence).find(
    (item) => readCodeMeaning(item?.ConceptNameCodeSequence) ===
      'Imaging Measurements'
  );

  return asSequence(imagingMeasurements?.ContentSequence).filter(
    (item) =>
      readCodeMeaning(item?.ConceptNameCodeSequence) ===
      'Measurement Group'
  );
}

function readNumericValue(item: any): number | undefined {
  const measuredValue = asSequence(item?.MeasuredValueSequence)[0];
  const value = Number(measuredValue?.NumericValue);
  return Number.isFinite(value) ? value : undefined;
}

function readUnit(item: any): string | undefined {
  const measuredValue = asSequence(item?.MeasuredValueSequence)[0];
  const unit = asSequence(
    measuredValue?.MeasurementUnitsCodeSequence
  )[0];
  const codeValue = String(unit?.CodeValue ?? '').trim();
  if (codeValue === '1' && /px/i.test(String(unit?.CodeMeaning ?? ''))) {
    return 'px';
  }
  return codeValue || undefined;
}

function toDisplayUnit(value: string): string {
  if (value === 'mm2') return 'mm²';
  if (value === 'mm3') return 'mm³';
  return value;
}

function getTrackingUID(measurementGroup: any): string {
  const trackingItem = asSequence(
    measurementGroup?.ContentSequence
  ).find(
    (item) =>
      readCodeMeaning(item?.ConceptNameCodeSequence) ===
      'Tracking Unique Identifier'
  );
  return String(trackingItem?.UID ?? '');
}

function getGroupStats(measurementGroup: any): Record<string, any> {
  const stats: Record<string, any> = {};

  for (const item of asSequence(measurementGroup?.ContentSequence)) {
    if (item?.ValueType !== 'NUM') continue;

    const value = readNumericValue(item);
    if (typeof value === 'undefined') continue;

    const meaning = readCodeMeaning(
      item?.ConceptNameCodeSequence
    ).toLowerCase();
    const unit = readUnit(item);

    if (meaning === 'length' || meaning === 'long axis') {
      stats.length = value;
      if (unit) stats.unit = toDisplayUnit(unit);
    } else if (meaning === 'short axis') {
      stats.width = value;
      if (unit) stats.widthUnit = toDisplayUnit(unit);
    } else if (meaning === 'area') {
      stats.area = value;
      if (unit) stats.areaUnit = toDisplayUnit(unit);
    } else if (meaning === 'perimeter') {
      stats.perimeter = value;
      if (unit) stats.unit = toDisplayUnit(unit);
    } else if (meaning === 'radius') {
      stats.radius = value;
      if (unit) stats.radiusUnit = toDisplayUnit(unit);
    } else if (meaning === 'angle' || meaning === 'cobb angle') {
      stats.angle = value;
      if (unit) stats.angleUnit = toDisplayUnit(unit);
    } else if (meaning === 'mean') {
      stats.mean = value;
      if (unit) stats.modalityUnit = unit;
    } else if (meaning === 'maximum') {
      stats.max = value;
      if (unit) stats.modalityUnit = unit;
    } else if (
      meaning === 'standard deviation' ||
      meaning === 'std dev'
    ) {
      stats.stdDev = value;
      if (unit) stats.modalityUnit = unit;
    }
  }

  return stats;
}

/**
 * adapters 3.33 chooses the first NUM item for Circle/PlanarFreehand. In
 * TID300 that item may be Perimeter, not Area. Restore the values by their
 * coded meaning and exact Tracking Unique Identifier after hydration.
 */
function restoreCodedStats(dataset: any, storedByTool: any): void {
  const statsByTrackingUID = new Map<string, Record<string, any>>();
  for (const group of getMeasurementGroups(dataset)) {
    const trackingUID = getTrackingUID(group);
    if (trackingUID) {
      statsByTrackingUID.set(trackingUID, getGroupStats(group));
    }
  }

  for (const toolDataList of Object.values(storedByTool ?? {})) {
    if (!Array.isArray(toolDataList)) continue;

    for (const toolData of toolDataList) {
      const trackingUID = String(
        toolData?.TrackingUniqueIdentifier ?? ''
      );
      const codedStats = statsByTrackingUID.get(trackingUID);
      const annotation = toolData?.annotation;
      const referencedImageId =
        annotation?.metadata?.referencedImageId;
      if (!codedStats || !referencedImageId) continue;

      const key = `imageId:${referencedImageId}`;
      annotation.data.cachedStats ??= {};
      annotation.data.cachedStats[key] = {
        ...(annotation.data.cachedStats[key] ?? {}),
        ...codedStats,
      };
    }
  }
}

function readHydratedLabel(toolData: any): string {
  const direct = toolData?.annotation?.data?.label;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const findingSites = Array.isArray(toolData?.findingSites)
    ? toolData.findingSites
    : [];
  for (const site of findingSites) {
    const label = readCodeMeaning(site);
    if (label) return label;
  }

  return readCodeMeaning(toolData?.finding);
}

function createFlatStats(
  toolName: string,
  annotationData: any,
  label: string
): Record<string, any> {
  const cachedStats = annotationData?.cachedStats ?? {};
  const stats = (Object.values(cachedStats)[0] ?? {}) as Record<string, any>;
  const result: Record<string, any> = {
    handles: annotationData?.handles ?? {},
  };

  switch (toolName) {
    case 'Length':
      result.length = stats.length;
      result.unit = stats.unit ?? 'mm';
      break;
    case 'Bidirectional':
      result.length = stats.length;
      result.unit = stats.unit ?? 'mm';
      result.width = stats.width;
      result.widthUnit = stats.widthUnit ?? stats.unit ?? 'mm';
      break;
    case 'ArrowAnnotate':
      result.text = annotationData?.text ?? label;
      break;
    case 'EllipticalROI':
    case 'RectangleROI':
    case 'CircleROI':
    case 'SplineROI':
      result.area = stats.area;
      result.areaUnit = stats.areaUnit ?? 'mm²';
      result.perimeter = stats.perimeter;
      result.radius = stats.radius;
      result.max = stats.max;
      result.modalityUnit = stats.modalityUnit;
      break;
    case 'Angle':
      result.angle = stats.angle;
      result.angleUnit = stats.angleUnit;
      break;
  }

  return result;
}

function findFrameIndex(imageId: string, reportImageIds: string[]): number {
  const index = findMatchingImageIdIndex(reportImageIds, imageId);
  return index >= 0 ? index : 0;
}

function createSplineControlPoints(polyline: any[]): any[] {
  if (!Array.isArray(polyline) || polyline.length < 3) return [];

  const lastIndex = polyline.length - 1;
  const step = Math.max(1, Math.floor(lastIndex / 12));
  const points = [];
  for (let index = 0; index < lastIndex; index += step) {
    points.push(polyline[index]);
  }
  points.push(polyline[lastIndex]);

  if (points.length >= 3) return points;
  return [
    polyline[0],
    polyline[Math.floor(lastIndex / 2)],
    polyline[lastIndex],
  ];
}

/**
 * The 3.33 SR package represents SplineROI as a PlanarFreehandROI subtype.
 * Hydration therefore returns a contour polyline, while SplineROITool needs a
 * runtime spline instance. Rebuild that runtime-only object before registering
 * the annotation so rendering cannot read an undefined `data.spline`.
 */
function prepareSplineAnnotation(annotation: any): void {
  const toolInstance =
    ToolGroupManager.getToolGroup(TOOL_GROUP)?.getToolInstance(
      SplineROITool.toolName
    ) ?? new SplineROITool();
  const polyline = annotation?.data?.contour?.polyline ?? [];
  const existingPoints = annotation?.data?.handles?.points ?? [];
  const controlPoints =
    existingPoints.length >= 3
      ? existingPoints
      : createSplineControlPoints(polyline);

  if (controlPoints.length < 3) {
    throw new Error('Hydrated SplineROI has fewer than three points.');
  }

  annotation.data.handles = {
    ...(annotation.data.handles ?? {}),
    points: controlPoints,
  };
  annotation.data.contour = {
    ...(annotation.data.contour ?? {}),
    closed: true,
  };

  const splineType =
    toolInstance?.configuration?.spline?.type ??
    SplineROITool.SplineTypes.CatmullRom;
  toolInstance.createSplineObjectFromType(annotation, splineType);
}

function getImageFrameNumber(imageId: string): number {
  const metadataFrame = Number(metaData.get('frameNumber', imageId));
  if (Number.isInteger(metadataFrame) && metadataFrame >= 1) {
    return metadataFrame;
  }

  const match = String(imageId).match(
    /(?:[?&]frame=|\/frames\/)(\d+)/i
  );
  const imageIdFrame = Number(match?.[1]);
  return Number.isInteger(imageIdFrame) && imageIdFrame >= 1
    ? imageIdFrame
    : 1;
}

function findReferencedSopSequence(value: any): any | null {
  if (!value || typeof value !== 'object') return null;

  const referencedSop = asSequence(value.ReferencedSOPSequence)[0];
  if (referencedSop?.ReferencedSOPInstanceUID) return referencedSop;

  for (const item of asSequence(value.ContentSequence)) {
    const nested = findReferencedSopSequence(item);
    if (nested) return nested;
  }

  return null;
}

function resolveGroupReferencedImageId(
  measurementGroup: any,
  imageIds: string[]
): {
  imageId: string;
  sopInstanceUID: string;
} {
  const referencedSop = findReferencedSopSequence(measurementGroup);
  const sopInstanceUID = String(
    referencedSop?.ReferencedSOPInstanceUID ?? ''
  );
  if (!sopInstanceUID) {
    throw new Error('SR measurement group has no referenced SOP Instance UID.');
  }

  const candidates = imageIds.filter((imageId) => {
    const sop = metaData.get('sopCommonModule', imageId) as
      | { sopInstanceUID?: string }
      | undefined;
    return sop?.sopInstanceUID === sopInstanceUID;
  });
  if (!candidates.length) {
    throw new Error(
      `Unable to resolve referenced SOP ${sopInstanceUID} in the source stack.`
    );
  }

  const referencedFrameNumber = Number(
    Array.isArray(referencedSop.ReferencedFrameNumber)
      ? referencedSop.ReferencedFrameNumber[0]
      : referencedSop.ReferencedFrameNumber
  );
  if (
    Number.isInteger(referencedFrameNumber) &&
    referencedFrameNumber >= 1
  ) {
    const frameMatch = candidates.find(
      (imageId) => getImageFrameNumber(imageId) === referencedFrameNumber
    );
    if (!frameMatch) {
      throw new Error(
        `Unable to resolve frame ${referencedFrameNumber} of SOP ${sopInstanceUID}.`
      );
    }
    return { imageId: frameMatch, sopInstanceUID };
  }

  if (candidates.length > 1) {
    throw new Error(
      `SR measurement for SOP ${sopInstanceUID} has no unambiguous frame reference.`
    );
  }

  return { imageId: candidates[0], sopInstanceUID };
}

function createSingleGroupDataset(dataset: any, measurementGroup: any): any {
  const contentSequence = asSequence(dataset?.ContentSequence);
  const imagingMeasurements = contentSequence.find(
    (item) =>
      readCodeMeaning(item?.ConceptNameCodeSequence) ===
      'Imaging Measurements'
  );
  if (!imagingMeasurements) {
    throw new Error('DICOM SR has no Imaging Measurements container.');
  }

  return {
    ...dataset,
    ContentSequence: contentSequence.map((item) =>
      item === imagingMeasurements
        ? {
            ...imagingMeasurements,
            ContentSequence: [measurementGroup],
          }
        : item
    ),
  };
}

/**
 * Cornerstone adapters 3.33 resolve SCOORD references by SOP UID only. Parse
 * one measurement group at a time so the plain SOP key can point at that
 * group's exact one-based ReferencedFrameNumber in a multiframe instance.
 */
function hydrateGroups(
  MeasurementReport: any,
  dataset: any,
  measurementGroups: any[],
  reportImageIds: string[]
): Record<string, any[]> {
  const merged: Record<string, any[]> = {};

  for (const measurementGroup of measurementGroups) {
    const { imageId, sopInstanceUID } = resolveGroupReferencedImageId(
      measurementGroup,
      reportImageIds
    );
    const groupDataset = createSingleGroupDataset(dataset, measurementGroup);
    const parsed = MeasurementReport.generateToolState(
      groupDataset,
      { [sopInstanceUID]: imageId },
      metaData
    );

    for (const [toolName, items] of Object.entries(parsed ?? {})) {
      if (!Array.isArray(items)) continue;
      merged[toolName] ??= [];
      merged[toolName].push(...items);
    }
  }

  return merged;
}

export type HydratedLocalSrMeasurement = {
  annotation: any;
  measurement: AnnotationMeasurement;
};

/**
 * Round-trip the generated dataset through the same adapter family OHIF uses
 * for SR hydration.  These annotations are a separate, read-only local view of
 * the report; source measurements remain untouched.
 */
export async function hydrateStructuredReportForLocalViewer({
  dataset,
  reportImageIds,
  reportSeriesInstanceUID,
  sourceSeriesInstanceUID,
  studyInstanceUID,
  viewportId,
}: {
  dataset: any;
  reportImageIds: string[];
  reportSeriesInstanceUID: string;
  sourceSeriesInstanceUID: string;
  studyInstanceUID: string;
  viewportId: string;
}): Promise<HydratedLocalSrMeasurement[]> {
  const { MeasurementReport } = await getCornerstoneSrRuntime();
  const measurementGroups = getMeasurementGroups(dataset);
  const storedByTool = hydrateGroups(
    MeasurementReport,
    dataset,
    measurementGroups,
    reportImageIds
  );
  const hydratedMeasurementCount = Object.values(
    storedByTool ?? {}
  ).reduce<number>(
    (total, items) =>
      total + (Array.isArray(items) ? items.length : 0),
    0
  );
  if (hydratedMeasurementCount !== measurementGroups.length) {
    throw new Error(
      `Only ${hydratedMeasurementCount}/${measurementGroups.length} SR measurement groups could be parsed.`
    );
  }
  restoreCodedStats(dataset, storedByTool);

  const createdAt = new Date().toISOString();
  const result: HydratedLocalSrMeasurement[] = [];

  for (const [toolName, toolDataList] of Object.entries(
    storedByTool ?? {}
  )) {
    const domainType = DOMAIN_TYPE_BY_TOOL_NAME[toolName];
    if (!domainType || !Array.isArray(toolDataList)) continue;

    for (const toolData of toolDataList as any[]) {
      const sourceAnnotation = toolData?.annotation;
      if (!sourceAnnotation?.annotationUID) continue;

      const referencedImageId = String(
        sourceAnnotation.metadata?.referencedImageId ?? ''
      );
      if (!referencedImageId) {
        throw new Error(
          `Unable to resolve the referenced image for hydrated ${toolName}.`
        );
      }

      const annotationUID = String(sourceAnnotation.annotationUID);
      const trackingUID = String(
        toolData?.TrackingUniqueIdentifier ?? annotationUID
      );
      const label = readHydratedLabel(toolData);
      const data = {
        ...(sourceAnnotation.data ?? {}),
        label,
      };
      const annotation = {
        ...sourceAnnotation,
        annotationUID,
        highlighted: false,
        isLocked: true,
        isPreview: false,
        metadata: {
          ...(sourceAnnotation.metadata ?? {}),
          toolName,
          referencedImageId,
          imageId: referencedImageId,
          seriesInstanceUID: sourceSeriesInstanceUID,
          seriesUID: sourceSeriesInstanceUID,
          reportSeriesInstanceUID,
          reportSeriesUID: reportSeriesInstanceUID,
          trackingUID,
          studyInstanceUID,
          createdAt,
        },
        data: {
          ...data,
          annotationUID,
        },
      };
      if (toolName === SplineROITool.toolName) {
        prepareSplineAnnotation(annotation);
      }
      const frameIndex = findFrameIndex(
        referencedImageId,
        reportImageIds
      );

      result.push({
        annotation,
        measurement: {
          annotationUID,
          toolName,
          label,
          type: domainType,
          data: createFlatStats(toolName, data, label),
          metadata: {
            seriesUID: sourceSeriesInstanceUID,
            reportSeriesUID: reportSeriesInstanceUID,
            trackingUID,
            studyUID: studyInstanceUID,
            viewportId,
            frameIndex,
            referencedImageId,
            imageId: referencedImageId,
            createdAt,
          },
          createdAt,
        },
      });
    }
  }

  return result;
}

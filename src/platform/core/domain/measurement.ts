import type { DicomUID } from './dicom';

export type MeasurementType =
  | 'length'
  | 'bidirectional'
  | 'arrowAnnotate'
  | 'ellipticalROI'
  | 'rectangleROI'
  | 'circleROI'
  | 'splineROI'
  | 'angle';

export interface MeasurementMetadata {
  seriesUID: DicomUID;
  studyUID: DicomUID;
  viewportId: string;
  frameIndex?: number;
  referencedImageId?: string;
  imageId?: string;
  createdAt: string;
}

/**
 * Canonical measurement model.  It mirrors the existing annotation model,
 * while keeping adapter-specific annotation data behind a generic parameter.
 */
export interface Measurement<TData = unknown> {
  annotationUID: string;
  toolName: string;
  label: string;
  type: MeasurementType;
  data: TData;
  metadata: MeasurementMetadata;
  createdAt: string;
}

export type AnnotationMeasurement<TData = unknown> = Measurement<TData>;

export interface MeasurementFilter {
  studyUID?: DicomUID;
  seriesUID?: DicomUID;
  viewportId?: string;
  toolName?: string;
}

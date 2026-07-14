import type { DicomSeries, DicomUID } from './dicom';

export interface VoiRange {
  lower: number;
  upper: number;
}

/**
 * Framework-neutral display set.
 *
 * The first five fields mirror the display set currently consumed by the
 * Cornerstone code.  The optional identity/metadata fields support gradual
 * adoption of an OHIF-style DisplaySetService without changing today's UI.
 */
export interface DisplaySet {
  imageIds: string[];
  initialImageIdIndex: number;
  initialVOIRange?: VoiRange | null;
  seriesInstanceUID?: DicomUID | null;

  displaySetInstanceUID?: DicomUID;
  studyInstanceUID?: DicomUID | null;
  sopClassUID?: DicomUID | null;
  modality?: string | null;
  metadata?: DicomSeries | Readonly<Record<string, unknown>>;
  isDerived?: boolean;
}

/** A display set after it has been assigned a service-owned identity. */
export type RegisteredDisplaySet = DisplaySet & {
  displaySetInstanceUID: DicomUID;
};

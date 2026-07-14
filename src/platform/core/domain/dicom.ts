/**
 * Canonical DICOM domain shapes used by the viewer core.
 *
 * These interfaces intentionally remain structurally compatible with the
 * legacy types in `lib/pacs/services.ts`.  Keeping them free of transport and
 * framework details lets a later data-source adapter adopt them incrementally.
 */

export type DicomUID = string;

export interface DicomInstance {
  sopInstanceUID?: DicomUID;
  instanceNumber?: number | null;
  url: string;
  filename?: string;
}

export interface DicomSeries {
  seriesDescription: string;
  seriesInstanceUID: DicomUID;
  seriesNumber: string;
  seriesModality: string;
  seriesRelatedInstanceCount: string;
  instances?: DicomInstance[];
}

export interface DicomStudy {
  patientName: string;
  studyDate: string;
  modalitiesInStudy: string;
  studyInstanceUID: DicomUID;
  seriesCount: number;
  imageCount: number;
  patientId: string;
  studyDescription: string;
  accessionNumber: string;
  series: DicomSeries[];
  studyTime?: string;
}

/** Compatibility names matching the current application imports. */
export type Instance = DicomInstance;
export type Series = DicomSeries;
export type Study = DicomStudy;

export interface SeriesMapEntry {
  files: string[];
  metadata: DicomSeries;
}

export type SeriesMap = Record<DicomUID, SeriesMapEntry>;

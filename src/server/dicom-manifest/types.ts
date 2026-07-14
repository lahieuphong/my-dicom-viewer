export type DicomManifestInstance = {
  sopInstanceUID?: string;
  instanceNumber?: number | null;
  url: string;
  filename?: string;
};

export type DicomManifestSeries = {
  seriesInstanceUID: string;
  seriesDescription: string;
  seriesNumber: string;
  seriesModality: string;
  seriesRelatedInstanceCount: string;
  instances?: DicomManifestInstance[];
};

export type DicomManifestStudy = {
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
  series: DicomManifestSeries[];
};

export type GetSeriesForStudyOptions = {
  includeInstances?: boolean;
};

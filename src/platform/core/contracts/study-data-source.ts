import type { DicomInstance, DicomSeries, DicomStudy, DicomUID } from '../domain';
import type { OperationSignal } from './disposable';

export interface DataSourceRequestOptions {
  signal?: OperationSignal;
}

export interface SeriesRequestOptions extends DataSourceRequestOptions {
  includeInstances?: boolean;
}

export interface StudyQuery extends DataSourceRequestOptions {
  patientName?: string;
  patientId?: string;
  accessionNumber?: string;
  modality?: string;
  studyDate?: string;
}

/**
 * Transport-neutral study data source.  Static manifests, the existing REST
 * routes and a future DICOMweb client can all implement this contract.
 */
export interface StudyDataSource {
  readonly id: string;
  queryStudies(query?: StudyQuery): Promise<DicomStudy[]>;
  getStudy(
    studyInstanceUID: DicomUID,
    options?: DataSourceRequestOptions
  ): Promise<DicomStudy | null>;
  getSeries(
    studyInstanceUID: DicomUID,
    options?: SeriesRequestOptions
  ): Promise<DicomSeries[]>;
  getInstances?(
    studyInstanceUID: DicomUID,
    seriesInstanceUID: DicomUID,
    options?: DataSourceRequestOptions
  ): Promise<DicomInstance[]>;
}

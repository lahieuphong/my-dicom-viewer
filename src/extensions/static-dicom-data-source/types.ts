import type {
  Instance,
  Series,
  SeriesRequestOptions,
  Study,
  StudyDataSource,
} from '@/platform/core';

export type { Instance, Series, Study };

export type FetchSeriesOptions = Pick<
  SeriesRequestOptions,
  'includeInstances'
>;

export type InstanceReference = {
  uid: string;
  number: number;
};

/**
 * Stable application-facing contract for the current study API.
 *
 * The implementation deliberately delegates to the legacy PACS client so its
 * request de-duplication, caches, URL handling, and prefetch behavior remain
 * unchanged while callers migrate to an extension boundary.
 */
export interface StaticDicomDataSource extends StudyDataSource {
  readonly id: 'static-dicom';
  getViewerPath(studyInstanceUID: string): string;
  getCachedStudies(): Study[] | null;
  setCachedStudies(studies: Study[]): void;
  listStudies(): Promise<Study[]>;
  prefetchStudy(studyInstanceUID: string): void;
}

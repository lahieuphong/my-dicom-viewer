/**
 * @deprecated Import from `@/extensions/static-dicom-data-source` and use
 * canonical domain types from `@/platform/core`.
 */
export {
  createStaticDicomDataSource,
  fetchInstances,
  fetchSeries,
  fetchStudiesWithMeta,
  fetchStudyMeta,
  getCachedStudies,
  getViewerPath,
  prefetchStudyViewerData,
  setCachedStudies,
  staticDicomDataSource,
} from '@/extensions/static-dicom-data-source';

export type {
  FetchSeriesOptions,
  Instance,
  InstanceReference,
  Series,
  StaticDicomDataSource,
  Study,
} from '@/extensions/static-dicom-data-source';

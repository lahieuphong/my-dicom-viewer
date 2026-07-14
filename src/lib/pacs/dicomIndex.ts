/**
 * @deprecated Import from `@/server/dicom-manifest` in server-only code.
 * This compatibility facade keeps older imports working during migration.
 */
export {
  getDicomIndex,
  getSeriesForStudy,
  getStudySummaries,
  getStudySummary,
} from '@/server/dicom-manifest';

export type {
  DicomManifestInstance,
  DicomManifestSeries,
  DicomManifestStudy,
  GetSeriesForStudyOptions,
} from '@/server/dicom-manifest';

import type { Study } from '@/platform/core';
import { fieldToString, normalizeValue } from '@/lib/utils';
import type { Instance, SeriesWithInstances, StudyFilters } from './types';

export const filterString = (value: unknown = '') =>
  (fieldToString(value) || '').toLowerCase();

export function truncateText(value?: string, max = 25) {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function filterStudies(studies: Study[], filters: StudyFilters) {
  return (studies || []).filter(
    (study) =>
      filterString(study.patientName).includes(filterString(filters.name)) &&
      filterString(study.patientId).includes(filterString(filters.id)) &&
      filterString(study.studyDate).includes(filterString(filters.date)) &&
      filterString(study.studyDescription).includes(filterString(filters.description)) &&
      filterString(study.modalitiesInStudy).includes(filterString(filters.modality)) &&
      filterString(study.studyInstanceUID).includes(filterString(filters.studyUID)) &&
      filterString(study.accessionNumber).includes(filterString(filters.accession))
  );
}

export function getStudyUid(study: Study, index: number) {
  return normalizeValue(study.studyInstanceUID) || `no-uid-${index}`;
}

export function getStudySeries(study: Study): SeriesWithInstances[] {
  return (study.series || []) as SeriesWithInstances[];
}

export function getStudyInstanceTotal(study: Study, seriesList = getStudySeries(study)) {
  if (seriesList.length) {
    return seriesList.reduce(
      (sum, series) =>
        sum + (parseInt(String(series.seriesRelatedInstanceCount || '0')) || 0),
      0
    );
  }

  return Number(study.imageCount) || 0;
}

export function getSeriesInstanceCount(series: SeriesWithInstances) {
  const instances = (Array.isArray(series.instances) ? series.instances : []) as (Instance | string)[];
  return parseInt(String(series.seriesRelatedInstanceCount || instances.length || '0')) || 0;
}

export async function prefetchFirstImageForStudy(study: Study) {
  void study;
}

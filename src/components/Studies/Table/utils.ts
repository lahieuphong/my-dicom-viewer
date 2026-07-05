import { imageLoader } from '@cornerstonejs/core';
import type { Study } from '@/lib/pacs/services';
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
  try {
    const seriesList = getStudySeries(study);
    if (!seriesList || seriesList.length === 0) return;

    let instanceCandidate: string | undefined;
    for (const series of seriesList) {
      const instances = (series.instances ?? []) as (Instance | string)[];
      if (Array.isArray(instances) && instances.length > 0) {
        const first = instances[0];
        if (typeof first === 'string') {
          instanceCandidate = first;
        } else if (first && typeof first === 'object') {
          instanceCandidate = first.url || first.filename || undefined;
        }
        if (instanceCandidate) break;
      }
    }

    if (!instanceCandidate) return;

    let absoluteUrl = String(instanceCandidate || '');
    if (!absoluteUrl.startsWith('http')) {
      if (typeof window !== 'undefined') {
        absoluteUrl = `${window.location.origin}${absoluteUrl}`;
      } else {
        return;
      }
    }

    const isLocalhost =
      typeof window !== 'undefined' &&
      (window.location.hostname === 'localhost' ||
        window.location.hostname === '127.0.0.1' ||
        window.location.hostname === '::1');
    const urlWithCacheBust = isLocalhost
      ? `${absoluteUrl}${absoluteUrl.includes('?') ? '&' : '?'}cacheBust=${Date.now()}`
      : absoluteUrl;
    const imageId = `wadouri:${urlWithCacheBust}`;

    try {
      if (imageLoader && typeof (imageLoader as any).loadAndCacheImage === 'function') {
        await (imageLoader as any).loadAndCacheImage(imageId).catch(() => {});
      } else {
        const csCore = await import('@cornerstonejs/core').catch(() => null);
        if (
          csCore &&
          csCore.imageLoader &&
          typeof csCore.imageLoader.loadAndCacheImage === 'function'
        ) {
          await csCore.imageLoader.loadAndCacheImage(imageId).catch(() => {});
        }
      }
    } catch {}
  } catch {}
}

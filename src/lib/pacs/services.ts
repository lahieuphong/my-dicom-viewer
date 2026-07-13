// src/lib/pacs/services.ts
import { PACS_API_BASE } from './config';

export interface Instance {
  sopInstanceUID?: string;
  instanceNumber?: number | null;
  url: string;       // "/dicoms/file.dcm" (relative) or full url
  filename?: string;
}

export interface Series {
  seriesDescription: string;
  seriesInstanceUID: string;
  seriesNumber: string;
  seriesModality: string;
  seriesRelatedInstanceCount: string;
  instances?: Instance[]; // thay đổi: giữ object thay vì string
}

export interface Study {
  patientName: string;
  studyDate: string;
  modalitiesInStudy: string;
  studyInstanceUID: string;
  seriesCount: number;
  imageCount: number;
  patientId: string;
  studyDescription: string;
  accessionNumber: string;
  series: Series[];
}

let studiesCache: Study[] | null = null;
let studiesRequest: Promise<Study[]> | null = null;
const studyMetaCache = new Map<string, Study | null>();
const studyMetaRequests = new Map<string, Promise<Study | null>>();
const seriesCache = new Map<string, Series[]>();
const seriesRequests = new Map<string, Promise<Series[]>>();
const seriesSummaryCache = new Map<string, Series[]>();
const seriesSummaryRequests = new Map<string, Promise<Series[]>>();

type FetchSeriesOptions = {
  includeInstances?: boolean;
};

function buildPacsApiUrl(pathname: string) {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  if (!PACS_API_BASE) return pathname;

  const base = PACS_API_BASE.replace(/\/+$/, '');
  const remotePath = pathname.replace(/^\/api(?=\/)/, '');
  const normalizedPath = remotePath.startsWith('/') ? remotePath : `/${remotePath}`;

  return `${base}${normalizedPath}`;
}

export function getViewerPath(studyInstanceUID: string) {
  return `/viewer?StudyInstanceUIDs=${encodeURIComponent(studyInstanceUID)}`;
}

export function getCachedStudies() {
  return studiesCache;
}

export function setCachedStudies(studies: Study[]) {
  studiesCache = studies;
}

export async function fetchStudiesWithMeta(): Promise<Study[]> {
  if (studiesCache) return studiesCache;

  if (!studiesRequest) {
    studiesRequest = fetch(buildPacsApiUrl('/api/studies'))
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load /api/studies: ${res.status}`);
        }
        const data = (await res.json()) as Study[];
        studiesCache = data;
        return data;
      })
      .finally(() => {
        studiesRequest = null;
      });
  }

  return studiesRequest;
}

export async function fetchStudyMeta(studyInstanceUID: string): Promise<Study | null> {
  if (studyMetaCache.has(studyInstanceUID)) {
    return studyMetaCache.get(studyInstanceUID) ?? null;
  }

  if (!studyMetaRequests.has(studyInstanceUID)) {
    const request = fetch(buildPacsApiUrl(`/api/studies/${encodeURIComponent(studyInstanceUID)}`))
      .then(async (res) => {
        if (res.status === 404) {
          studyMetaCache.set(studyInstanceUID, null);
          return null;
        }
        if (!res.ok) {
          throw new Error(`Failed to load study metadata: ${res.status}`);
        }
        const data = (await res.json()) as Study;
        studyMetaCache.set(studyInstanceUID, data);
        return data;
      })
      .finally(() => {
        studyMetaRequests.delete(studyInstanceUID);
      });

    studyMetaRequests.set(studyInstanceUID, request);
  }

  return studyMetaRequests.get(studyInstanceUID)!;
}

export async function fetchSeries(
  studyInstanceUID: string,
  options: FetchSeriesOptions = {}
): Promise<Series[]> {
  const includeInstances = options.includeInstances !== false;
  const cache = includeInstances ? seriesCache : seriesSummaryCache;
  const requests = includeInstances ? seriesRequests : seriesSummaryRequests;
  const cached = cache.get(studyInstanceUID);
  if (cached) return cached;

  if (!requests.has(studyInstanceUID)) {
    const query = includeInstances ? '' : '?includeInstances=false';
    const request = fetch(buildPacsApiUrl(`/api/studies/${encodeURIComponent(studyInstanceUID)}/series${query}`))
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load study series: ${res.status}`);
        }
        const data = (await res.json()) as Series[];
        cache.set(studyInstanceUID, data);
        return data;
      })
      .finally(() => {
        requests.delete(studyInstanceUID);
      });

    requests.set(studyInstanceUID, request);
  }

  return requests.get(studyInstanceUID)!;
}

export async function fetchInstances(studyInstanceUID: string, seriesInstanceUID: string) {
  const series = await fetchSeries(studyInstanceUID);
  const s = series.find(x => x.seriesInstanceUID === seriesInstanceUID);
  if (!s) return [];
  return (s.instances || []).map((inst, idx) => ({
    uid: (typeof inst === 'string') ? inst : inst.url ?? inst.filename ?? `/dicoms/unknown-${idx}`,
    number: idx + 1,
  }));
}

export function prefetchStudyViewerData(studyInstanceUID: string) {
  void fetchStudyMeta(studyInstanceUID).catch(() => null);
  void fetchSeries(studyInstanceUID, { includeInstances: false }).catch(() => []);
}

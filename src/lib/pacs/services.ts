// src/lib/pacs/services.ts
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

export function getCachedStudies() {
  return studiesCache;
}

export function setCachedStudies(studies: Study[]) {
  studiesCache = studies;
}

export async function fetchStudiesWithMeta(): Promise<Study[]> {
  if (studiesCache) return studiesCache;

  if (!studiesRequest) {
    studiesRequest = fetch('/api/studies')
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
    const request = fetch(`/api/studies/${encodeURIComponent(studyInstanceUID)}`)
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

export async function fetchSeries(studyInstanceUID: string): Promise<Series[]> {
  const cached = seriesCache.get(studyInstanceUID);
  if (cached) return cached;

  if (!seriesRequests.has(studyInstanceUID)) {
    const request = fetch(`/api/studies/${encodeURIComponent(studyInstanceUID)}/series`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`Failed to load study series: ${res.status}`);
        }
        const data = (await res.json()) as Series[];
        seriesCache.set(studyInstanceUID, data);
        return data;
      })
      .finally(() => {
        seriesRequests.delete(studyInstanceUID);
      });

    seriesRequests.set(studyInstanceUID, request);
  }

  return seriesRequests.get(studyInstanceUID)!;
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

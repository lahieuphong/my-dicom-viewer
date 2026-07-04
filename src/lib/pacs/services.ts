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

export async function fetchStudiesWithMeta(): Promise<Study[]> {
  const res = await fetch('/api/dicoms');
  if (!res.ok) {
    throw new Error(`Failed to load /api/dicoms: ${res.status}`);
  }
  const data = await res.json();
  return data as Study[];
}

export async function fetchSeries(studyInstanceUID: string): Promise<Series[]> {
  const studies = await fetchStudiesWithMeta();
  const st = studies.find(s => s.studyInstanceUID === studyInstanceUID);
  return st ? st.series : [];
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

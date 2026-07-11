// Current viewer contract consumes concrete Instance.url values. They can come
// from the local static sample API or from a real PACS/backend adapter.
export const USE_STATIC_DICOMS = true;
export const DICOMS_INDEX_URL = '/dicoms/index.json';

// Optional remote API base for real data later.
// Expected endpoints with the same DTO shape:
//   GET <base>/studies
//   GET <base>/studies/:studyUID
//   GET <base>/studies/:studyUID/series
export const PACS_API_BASE = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_PACS_API_BASE
  ? process.env.NEXT_PUBLIC_PACS_API_BASE
  : '';

export const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/dicom+json, application/json',
};

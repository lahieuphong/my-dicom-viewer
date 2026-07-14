/**
 * Public DICOM data configuration.
 *
 * Keep this module free of React, Next.js and Cornerstone so data-source
 * adapters can consume it without depending on a UI or rendering layer.
 */

export const USE_STATIC_DICOMS = true;
export const DICOMS_INDEX_URL = '/dicoms/index.json';

// Optional remote API base. The remote service is expected to expose the same
// DTO shape as the local static-manifest API.
export const PACS_API_BASE =
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_PACS_API_BASE
    ? process.env.NEXT_PUBLIC_PACS_API_BASE
    : '';

export const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/dicom+json, application/json',
};

export const dicomConfig = Object.freeze({
  useStaticDicoms: USE_STATIC_DICOMS,
  dicomsIndexUrl: DICOMS_INDEX_URL,
  pacsApiBase: PACS_API_BASE,
  defaultHeaders: DEFAULT_HEADERS,
});

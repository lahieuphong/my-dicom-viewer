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

// Optional base for relative instance URLs. Keeping this separate from the
// metadata API supports deployments where JSON and DICOM objects live on
// different origins (for example, an API plus signed object storage).
export const DICOM_ASSET_BASE =
  typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_DICOM_ASSET_BASE
    ? process.env.NEXT_PUBLIC_DICOM_ASSET_BASE
    : '';

export const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/dicom+json, application/json',
};

const NON_HTTP_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Resolve a manifest instance reference into a Cornerstone image ID.
 *
 * Resolution order for relative paths:
 *  1. NEXT_PUBLIC_DICOM_ASSET_BASE
 *  2. NEXT_PUBLIC_PACS_API_BASE
 *  3. the current browser origin
 *
 * Remote APIs should still prefer absolute, short-lived signed HTTPS URLs.
 */
export function resolveDicomImageId(
  rawValue: string,
  browserOrigin: string
): string {
  const value = String(rawValue ?? '').trim();
  if (!value) return '';

  // Cornerstone-native and other non-HTTP schemes are already complete image
  // IDs. Re-prefixing them with wadouri would corrupt the loader scheme.
  if (NON_HTTP_SCHEME.test(value) && !/^https?:/i.test(value)) {
    return value;
  }

  try {
    const originUrl = new URL('/', browserOrigin);
    const configuredBase = DICOM_ASSET_BASE || PACS_API_BASE;
    const baseUrl = configuredBase
      ? new URL(configuredBase, originUrl)
      : originUrl;

    if (!baseUrl.pathname.endsWith('/')) {
      baseUrl.pathname = `${baseUrl.pathname}/`;
    }

    return `wadouri:${new URL(value, baseUrl).toString()}`;
  } catch {
    // Keep same-origin behavior as a defensive fallback for malformed config.
    const normalizedOrigin = browserOrigin.replace(/\/+$/, '');
    const normalizedPath = value.startsWith('/') ? value : `/${value}`;
    return `wadouri:${normalizedOrigin}${normalizedPath}`;
  }
}

export const dicomConfig = Object.freeze({
  useStaticDicoms: USE_STATIC_DICOMS,
  dicomsIndexUrl: DICOMS_INDEX_URL,
  pacsApiBase: PACS_API_BASE,
  dicomAssetBase: DICOM_ASSET_BASE,
  defaultHeaders: DEFAULT_HEADERS,
});

export const USE_STATIC_DICOMS = true; // bật chế độ static
export const DICOMS_INDEX_URL = '/dicoms/index.json'; // fetch từ public/

// Nếu bạn vẫn có PACS API và muốn fallback, thêm biến env. Nhưng mặc định hiện tại là static mode.
export const PACS_API_BASE = typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_PACS_API_BASE
  ? process.env.NEXT_PUBLIC_PACS_API_BASE
  : '';

export const DEFAULT_HEADERS: Record<string, string> = {
  Accept: 'application/dicom+json, application/json',
};
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Chuyển đổi định dạng ngày DICOM (YYYYMMDD) thành DD/MM/YYYY
 * @param studyDate chuỗi ngày định dạng DICOM, ví dụ: "20250731"
 * @returns định dạng "31/07/2025", hoặc trả về nguyên gốc nếu không hợp lệ
 */
export function formatStudyDate(studyDate: string): string {
  if (!studyDate || studyDate.length !== 8) return studyDate;
  const y = studyDate.slice(0, 4);
  const m = studyDate.slice(4, 6);
  const d = studyDate.slice(6, 8);
  return `${d}/${m}/${y}`;
}

/* ---------- UI string helpers (normalize & field -> string) ---------- */

/**
 * Placeholder dùng cho giá trị "empty" trong UI.
 * Trả về chuỗi rỗng '' khi muốn hiển thị ô trống thay vì các token như '–' hay 'null'.
 */
export const PLACEHOLDER = '';

/**
 * Chuẩn hoá một giá trị bất kỳ thành chuỗi hiển thị ngắn gọn cho UI.
 * - Trả '' (PLACEHOLDER) cho các giá trị xem là "empty" (null, '', '–', 'null', ...)
 * - Nếu là object person name (Alphabetic/Ideographic/Phonetic) -> ghép phần tương ứng
 * - Nếu là mảng -> nối các phần bằng backslash '\'
 * - Nếu là object khác -> cố gắng lấy các giá trị chuỗi/number/boolean, hoặc JSON stringify (cắt nếu quá dài)
 */
export function normalizeValue(v: any): string {
  if (v == null) return PLACEHOLDER;

  const isPlaceholderToken = (s: string) => {
    const t = (s ?? '').trim();
    return (
      t === '' ||
      t === '-' ||
      t === '-' ||
      t === '—' ||
      t.toLowerCase() === 'null' ||
      t.toLowerCase() === 'undefined'
    );
  };

  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    const s = String(v);
    return isPlaceholderToken(s) ? PLACEHOLDER : s.trim();
  }

  if (Array.isArray(v)) {
    const mapped = v.map(item => normalizeValue(item)).filter(Boolean);
    return mapped.length ? mapped.join('\\') : PLACEHOLDER;
  }

  if (typeof v === 'object') {
    // Person name objects
    if ('Alphabetic' in v || 'Ideographic' in v || 'Phonetic' in v) {
      // @ts-ignore
      const parts = [v.Alphabetic, v.Ideographic, v.Phonetic].filter(Boolean).map(String);
      const joined = parts.length ? parts.join('\\') : '';
      return isPlaceholderToken(joined) ? PLACEHOLDER : joined;
    }

    // Dcmjs style { Value: [...] }
    if ('Value' in v && Array.isArray((v as any).Value)) {
      return normalizeValue((v as any).Value);
    }

    const vals = Object.values(v).filter(x => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean');
    if (vals.length) {
      const joined = vals.map(String).join('\\');
      return isPlaceholderToken(joined) ? PLACEHOLDER : joined;
    }

    try {
      const json = JSON.stringify(v);
      if (!json) return PLACEHOLDER;
      return json.length > 120 ? json.slice(0, 120) + '…' : json;
    } catch {
      return PLACEHOLDER;
    }
  }

  return String(v);
}

/**
 * Chuyển bất kỳ giá trị nào thành chuỗi phục vụ cho việc so sánh / filter.
 * - Trả '' cho null/undefined để includes('') === true (không lọc)
 * - Ghép mảng bằng '\' và object person name theo trường Alphabetic/...
 * - Dùng JSON.stringify fallback khi cần
 */
export function fieldToString(v: any): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return String(v).trim();
  }
  if (Array.isArray(v)) {
    return v.map(fieldToString).filter(Boolean).join('\\');
  }
  if (typeof v === 'object') {
    if ('Alphabetic' in v || 'Ideographic' in v || 'Phonetic' in v) {
      // @ts-ignore
      const parts = [v.Alphabetic, v.Ideographic, v.Phonetic].filter(Boolean).map(String);
      return parts.join('\\');
    }
    if ('Value' in v && Array.isArray((v as any).Value)) {
      return fieldToString((v as any).Value[0]);
    }
    const vals = Object.values(v).filter(x => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean');
    if (vals.length) return vals.map(String).join('\\');
    try {
      return JSON.stringify(v);
    } catch {
      return '';
    }
  }
  return String(v);
}
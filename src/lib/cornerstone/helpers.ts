// src/lib/cornerstone/helpers.ts
/**
 * Helpers liên quan tới Cornerstone / EnabledElement / ImageId normalization
 * và một số wrapper "best-effort" để tương tác an toàn với API annotation.
 *
 * Mục tiêu:
 * - Cung cấp cả wrapper đơn giản (safeGetEnabledElement) và hàm tìm enabled element "mạnh mẽ" hơn (getEnabledElementSafe).
 * - Giữ các hàm không phụ thuộc ngầm vào biến cục bộ của component — truyền param rõ ràng.
 *
 * Ghi chú: hàm getEnabledElement được import từ @cornerstonejs/core để sử dụng khi có sẵn.
 */

import { getEnabledElement } from '@cornerstonejs/core';

/* =========================
   Enabled-element helpers
   ========================= */

/**
 * Very small safe wrapper around imported getEnabledElement.
 * Tránh ném lỗi: trả về null nếu getEnabledElement throws.
 */
export function safeGetEnabledElement(el: HTMLElement | null): any | null {
  if (!el) return null;
  try {
    return getEnabledElement(el as HTMLDivElement);
  } catch {
    return null;
  }
}

/**
 * Best-effort: try to obtain a Cornerstone *enabled element* from several candidates.
 * - first tries direct candidate via global cornerstone.getEnabledElement (if present)
 * - tries some typical child selectors (canvas, .viewport-element, data attrs)
 * - finally does a global search for likely elements
 *
 * Returns the enabledElement-like object or null.
 *
 * Note: this function prefers the global (window.cornerstone) getter to allow mixed integration modes,
 * but will also work if you call safeGetEnabledElement on a direct element.
 */
export function getEnabledElementSafe(el: HTMLElement | null): any | null {
  if (!el) return null;

  const tryGet = (candidate: Element | null) => {
    try {
      // Prefer global cornerstone (works for some integrations)
      // @ts-ignore
      const globalCornerstone = (window as any).cornerstone;
      if (globalCornerstone && typeof globalCornerstone.getEnabledElement === 'function') {
        try {
          return globalCornerstone.getEnabledElement(candidate);
        } catch {}
      }
    } catch {}

    // Fallback to imported getEnabledElement if candidate is the exact element
    try {
      return getEnabledElement(candidate as any);
    } catch {
      // ignore
    }

    return null;
  };

  try {
    // 1) Try the element itself
    const direct = tryGet(el);
    if (direct) return direct;
  } catch {}

  // 2) Try inner candidate selectors commonly used by DicomViewport implementations
  const selectors = [
    '.viewport-element',
    'canvas.cornerstone-canvas',
    '[data-viewport-uid]',
    '[data-viewport-role="content"]',
  ];

  for (const sel of selectors) {
    try {
      const c = el.querySelector?.(sel);
      if (c) {
        const en = tryGet(c);
        if (en) return en;
      }
    } catch {
      // ignore selector errors
    }
  }

  // 3) global search as last resort (may be expensive)
  try {
    const all = Array.from(
      document.querySelectorAll('.viewport-element, canvas.cornerstone-canvas, [data-viewport-role="content"]')
    );
    for (const c of all) {
      try {
        const en = tryGet(c);
        if (en) return en;
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  return null;
}

/* =========================
   ImageId normalization
   ========================= */

/**
 * Normalize an imageId string:
 * - remove leading "imageId:" if present
 * - strip query string
 * - trim trailing slash
 */
export function normalizeImageId(id?: string): string {
  if (!id) return '';
  let s = String(id);
  if (s.startsWith('imageId:')) s = s.replace(/^imageId:/, '');
  const q = s.indexOf('?');
  if (q >= 0) s = s.slice(0, q);
  if (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/**
 * Alias for normalizeImageId for compatibility with older code using `normalizeId`.
 */
export const normalizeId = normalizeImageId;

/* =========================
   Safe inspect (debug)
   ========================= */

/**
 * Lightweight safe inspection useful for debug logs.
 * Avoids calling getters that may throw; returns a shallow summary.
 */
export function safeInspect(obj: any, maxKeys = 40): any {
  try {
    if (obj == null) return obj;
    const t = typeof obj;
    if (t === 'string' || t === 'number' || t === 'boolean') return obj;
    if (obj instanceof HTMLElement) {
      return {
        __type: 'HTMLElement',
        tagName: obj.tagName,
        id: obj.id || null,
        className: obj.className || null,
        width: (obj as any).offsetWidth ?? null,
        height: (obj as any).offsetHeight ?? null,
      };
    }
    const out: Record<string, any> = { __type: Object.prototype.toString.call(obj) };
    const keys = Object.keys(obj).slice(0, maxKeys);
    for (const k of keys) {
      try {
        const v = obj[k];
        const vt = typeof v;
        if (vt === 'function') out[k] = '[fn]';
        else if (v instanceof HTMLElement) out[k] = { __type: 'HTMLElement', tagName: v.tagName, id: v.id || null };
        else if (vt === 'object' && v !== null) out[k] = `[object ${Object.prototype.toString.call(v)}]`;
        else out[k] = v;
      } catch {
        out[k] = '[throws]';
      }
    }
    try { if (obj?.id) out.__id = obj.id; } catch {}
    try { if (obj?.name) out.__name = obj.name; } catch {}
    try { if (obj?.constructor?.name) out.__ctor = obj.constructor.name; } catch {}
    return out;
  } catch {
    return '[inspect-failed]';
  }
}

/* =========================
   Annotation helpers (best-effort wrappers)
   ========================= */

/**
 * Best-effort: set annotation visibility using known API shapes.
 * Accepts either the annotation module (annotation or annotation.visibility) or a state-like object.
 */
export function safeSetAnnotationVisibility(stateAny: any, annotationUID: string, visible: boolean): boolean {
  if (!stateAny || !annotationUID) return false;
  try {
    // prefer .visibility sub-object if present
    const vis = stateAny.visibility ?? stateAny;
    if (vis && typeof vis.setAnnotationVisibility === 'function') {
      vis.setAnnotationVisibility(annotationUID, visible);
      return true;
    }
    if (typeof stateAny.setAnnotationVisibility === 'function') {
      stateAny.setAnnotationVisibility(annotationUID, visible);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Best-effort: remove an annotation by uid or instance object.
 * Tries a set of likely API names and patterns used across cornerstone-tools versions.
 */
export async function safeRemoveAnnotation(stateAny: any, annotationUID: string): Promise<boolean> {
  if (!stateAny || !annotationUID) return false;

  // candidates that might accept uid or instance
  const candidates = ['removeAnnotation', 'deleteAnnotation', 'remove', 'delete'];

  // 1) Try direct API names (uid)
  for (const fnName of candidates) {
    try {
      const fn = stateAny?.[fnName];
      if (typeof fn === 'function') {
        const res = fn.call(stateAny, annotationUID);
        if (res && typeof res.then === 'function') {
          await res;
        }
        return true;
      }
    } catch {
      // ignore and continue
    }
  }

  // 2) Try fetching instance then removing by instance
  try {
    const inst = stateAny.getAnnotation?.(annotationUID) ?? null;
    if (inst) {
      for (const fnName of candidates) {
        try {
          const fn = stateAny?.[fnName];
          if (typeof fn === 'function') {
            const res = fn.call(stateAny, inst);
            if (res && typeof res.then === 'function') await res;
            return true;
          }
        } catch {
          // continue
        }
      }
    }
  } catch {
    // ignore
  }

  return false;
}

/* =========================
   Viewport instrumentation
   ========================= */

export function instrumentViewportLogging(vp: any): void {
  void vp;
}

/* =========================
   Exports summary
   ========================= */

/*
  Exported functions (available):
  - safeGetEnabledElement
  - getEnabledElementSafe
  - normalizeImageId (alias normalizeId)
  - safeInspect
  - safeSetAnnotationVisibility
  - safeRemoveAnnotation
  - instrumentViewportLogging
*/

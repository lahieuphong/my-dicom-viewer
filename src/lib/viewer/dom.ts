// src/lib/viewer/dom.ts
// NOTE: do not import @cornerstonejs/core here at module top-level.
// This file offers safe, synchronous helpers and so must avoid static requires
// that the bundler will try to resolve server-side.

'use client';

import { normalizeImageId as normalizeImageIdFromHelpers } from '@/lib/cornerstoneHelpers';

/**
 * Re-export canonical normalizer from shared helper so callers can continue
 * importing from '@/lib/viewer/dom' without having to change paths.
 *
 * This avoids duplicate implementations across the codebase.
 */
export const normalizeId = normalizeImageIdFromHelpers;
export const normalizeImageId = normalizeImageIdFromHelpers;

/**
 * Try to get a Cornerstone "enabled element" from a container element.
 * This function is synchronous (so consumers can check quickly). If the global
 * core isn't yet available, we schedule a background dynamic import so that a
 * later call may succeed.
 *
 * Returns enabledElement object or null.
 */
// thay thế hàm getEnabledElementSafeLocal hiện có bằng đoạn này

export function getEnabledElementSafeLocal(vpEl: HTMLElement | null): any | null {
  if (!vpEl) return null;

  // small helper to push debug info (non-blocking)
  try {
    const w: any = (typeof window !== 'undefined') ? (window as any) : null;
    if (w) {
      w.__viewerLog = w.__viewerLog || [];
      // keep bounded size
      if (w.__viewerLog.length > 2000) w.__viewerLog.splice(0, w.__viewerLog.length - 2000);
    }
    const push = (msg: any) => { try { if (w) w.__viewerLog.push({ t: Date.now(), msg }); } catch {} };
    push(`getEnabledElementSafeLocal start for ${vpEl?.tagName}`);
  } catch {}

  const tryGetFromCore = (core: any, el: Element | null) => {
    if (!core || !el) return null;
    try {
      if (typeof core.getEnabledElement === 'function') {
        try {
          // IMPORTANT: guard against RangeError inside core.getEnabledElement
          return core.getEnabledElement(el as any);
        } catch (err: any) {
          // If we hit a RangeError (call stack overflow) or other serious error, return null.
          if (err && err instanceof RangeError) {
            try { (window as any).__viewerLog?.push({ t: Date.now(), msg: 'getEnabledElement -> RangeError, returning null' }); } catch {}
            return null;
          }
          // rethrow other unexpected errors so callers can decide
          throw err;
        }
      }
      if (core.cornerstone && typeof core.cornerstone.getEnabledElement === 'function') {
        try {
          return core.cornerstone.getEnabledElement(el as any);
        } catch (err: any) {
          if (err && err instanceof RangeError) {
            try { (window as any).__viewerLog?.push({ t: Date.now(), msg: 'legacy cornerstone.getEnabledElement -> RangeError, returning null' }); } catch {}
            return null;
          }
          throw err;
        }
      }
    } catch (e) {
      // swallow and return null (we want safe helper)
      return null;
    }
    return null;
  };

  const tryGet = (el: Element | null) => {
    if (!el) return null;
    try {
      // 1) prefer explicit global we've set during init
      const csCore = (typeof window !== 'undefined' && (window as any).__cornerstoneCore) || null;
      const fromCsCore = tryGetFromCore(csCore, el);
      if (fromCsCore) return fromCsCore;
    } catch {}

    try {
      // 2) legacy global "cornerstone"
      const legacy = (typeof window !== 'undefined' && (window as any).cornerstone) || null;
      const fromLegacy = tryGetFromCore(legacy, el);
      if (fromLegacy) return fromLegacy;
    } catch {}

    return null;
  };

  // 1) direct on passed element (guarded)
  try {
    const direct = tryGet(vpEl);
    if (direct) return direct;
  } catch (err) {
    // If core.getEnabledElement throws other error, bail to null safely
    try { (window as any).__viewerLog?.push({ t: Date.now(), msg: 'getEnabledElementSafeLocal direct tryGet threw, returning null' }); } catch {}
    return null;
  }

  // 2) try a set of likely inner candidates but limit attempts to avoid heavy recursion
  try {
    const candidates = [
      vpEl.querySelector?.('.viewport-element'),
      vpEl.querySelector?.('canvas.cornerstone-canvas'),
      vpEl.querySelector?.('[data-viewport-uid]'),
      vpEl.querySelector?.('[data-viewport-role="content"]'),
    ].filter(Boolean) as Element[];

    // limit how many candidates we'll try
    const maxCandidates = Math.min(6, candidates.length);
    for (let i = 0; i < maxCandidates; i++) {
      const c = candidates[i];
      try {
        const en = tryGet(c);
        if (en) return en;
      } catch {}
    }
  } catch {}

  // 3) global search last-resort but limited to first N matches
  try {
    const all = Array.from(document.querySelectorAll('.viewport-element, canvas.cornerstone-canvas, [data-viewport-role="content"]'));
    const limit = Math.min(8, all.length);
    for (let i = 0; i < limit; i++) {
      const c = all[i];
      try {
        const en = tryGet(c);
        if (en) return en;
      } catch {}
    }
  } catch {}

  // 4) background dynamic import to populate window.__cornerstoneCore if missing (non-blocking)
  //    Also set __cornerstoneReady = true after successful import so pollers see "ready".
  try {
    const csReady = Boolean((window as any).__cornerstoneReady);
    if (!csReady) {
      (async () => {
        try {
          const coreModule = await import('@cornerstonejs/core').catch(() => null);
          if (coreModule) {
            (window as any).__cornerstoneCore = coreModule;
            // expose convenience loader fn for other helpers
            try {
              if (coreModule.imageLoader && typeof coreModule.imageLoader.loadAndCacheImage === 'function') {
                (window as any).__cornerstoneImageLoaderFn = coreModule.imageLoader.loadAndCacheImage.bind(coreModule.imageLoader);
              }
            } catch {}
            // mark ready so waiters/pollers can proceed
            try { (window as any).__cornerstoneReady = true; } catch {}
            try { (window as any).__viewerLog?.push({ t: Date.now(), msg: 'dynamic import cornerstone core done -> __cornerstoneReady=true' }); } catch {}
          }
        } catch (e) {
          try { (window as any).__viewerLog?.push({ t: Date.now(), msg: `dynamic import cornerstone core failed: ${String(e)}` }); } catch {}
        }
      })();
    }
  } catch {}

  return null;
}

export function getEnabledElementSafe(vpEl: HTMLElement | null): any | null {
  return getEnabledElementSafeLocal(vpEl);
}

export function safeInspectSimple(el: HTMLElement | null) {
  try {
    if (!el) return null;
    return { tagName: el.tagName, width: el.offsetWidth, height: el.offsetHeight, className: (el.className || '').slice(0, 200) };
  } catch { return null; }
}

export function safeInspect(obj: any) {
  try {
    if (obj == null) return obj;
    const t = typeof obj;
    if (t === 'string' || t === 'number' || t === 'boolean') return obj;
    if (obj instanceof HTMLElement) {
      return { __type: 'HTMLElement', tagName: obj.tagName, id: obj.id || null, className: obj.className || null, width: (obj as any).offsetWidth ?? null, height: (obj as any).offsetHeight ?? null };
    }

    const out: Record<string, any> = { __type: Object.prototype.toString.call(obj) };
    const keys = Object.keys(obj || {}).slice(0, 40);
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

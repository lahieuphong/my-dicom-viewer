// src/lib/viewer/annotationHelpers.ts
'use client';

import { annotation as csAnnotation } from '@cornerstonejs/tools';

/**
 * Centralized, best-effort annotation helpers.
 * - Avoid duplicate adds by checking existing annotations on target element first.
 * - Track attachments globally so a single remove can detach from all elements.
 * - Try multiple API shapes for add/remove to be compatible with different versions.
 * - Set visibility when adding; clear visibility when removing where possible.
 *
 * Note: We use a global map `window.__annotationAttachments` to track which DOM elements (by
 * reference) an annotationUID is attached to. This avoids needing to rely on ambiguous library internals.
 */

/** Global tracking map: uid -> Set<HTMLElement>. Stored on window to survive module reloads. */
function getAttachmentMap(): Map<string, Set<HTMLElement>> {
  try {
    const win: any = typeof window !== 'undefined' ? window : (globalThis as any);
    if (!win.__annotationAttachments || !(win.__annotationAttachments instanceof Map)) {
      win.__annotationAttachments = new Map();
    }
    return win.__annotationAttachments as Map<string, Set<HTMLElement>>;
  } catch {
    // fallback ephemeral map (should rarely happen)
    if (!(getAttachmentMap as any)._fallback) (getAttachmentMap as any)._fallback = new Map();
    return (getAttachmentMap as any)._fallback;
  }
}

function recordAttachment(uid: string, el: HTMLElement | null) {
  if (!uid || !el) return;
  try {
    const map = getAttachmentMap();
    let s = map.get(uid);
    if (!s) {
      s = new Set();
      map.set(uid, s);
    }
    s.add(el);
  } catch {}
}

function removeAttachmentRecord(uid: string, el?: HTMLElement | null) {
  try {
    const map = getAttachmentMap();
    const s = map.get(uid);
    if (!s) return;
    if (el) {
      s.delete(el);
    } else {
      s.clear();
    }
    if (s.size === 0) map.delete(uid);
  } catch {}
}

function listAttachmentElements(uid: string): HTMLElement[] {
  try {
    const map = getAttachmentMap();
    const s = map.get(uid);
    return s ? Array.from(s) : [];
  } catch {
    return [];
  }
}

/**
 * Tiny global set to mark recently removed annotations and avoid immediate re-attachment races.
 * Stored on window so it survives module reloads in dev.
 */
export function getRecentlyRemovedSet(): Set<string> {
  try {
    const w: any = typeof window !== 'undefined' ? (window as any) : null;
    if (!w) return new Set();
    if (!w.__recentlyRemovedAnnotations || !(w.__recentlyRemovedAnnotations instanceof Set)) {
      w.__recentlyRemovedAnnotations = new Set();
    }
    return w.__recentlyRemovedAnnotations as Set<string>;
  } catch {
    // fallback ephemeral set
    if (!(getRecentlyRemovedSet as any)._fallback) (getRecentlyRemovedSet as any)._fallback = new Set();
    return (getRecentlyRemovedSet as any)._fallback as Set<string>;
  }
}

/**
 * Best-effort: add annotation instance to element only if not already attached there.
 * Records the attachment in the global map.
 */
export async function safeAddAnnotation(inst: any, el: HTMLDivElement | null): Promise<boolean> {
  if (!inst || !el) return false;

  // If this annotation was recently removed, avoid re-attaching immediately.
  try {
    const recent = getRecentlyRemovedSet();
    if (recent.has(inst.annotationUID)) {
      // skip attach for now (caller may retry later)
      return false;
    }
  } catch {
    // ignore
  }

  try {
    // If annotation already present on that element, skip adding again.
    try {
      const anns = (csAnnotation.state?.getAnnotations?.(inst?.toolName, el) ?? []) as any[];
      if (Array.isArray(anns) && anns.some((a) => a?.annotationUID === inst.annotationUID)) {
        // already attached on this element
        try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(inst.annotationUID, true); } catch {}
        recordAttachment(inst.annotationUID, el);
        return true;
      }
    } catch {
      // ignore getAnnotations failures
    }

    // Primary preferred API
    const add = (csAnnotation.state as any)?.addAnnotation;
    if (typeof add === 'function') {
      // add may be async or sync
      await add(inst, el);
      try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(inst.annotationUID, true); } catch {}
      recordAttachment(inst.annotationUID, el);
      return true;
    }

    // Fallback shapes
    const altAdd = (csAnnotation.state as any)?.add ?? (csAnnotation as any)?.add;
    if (typeof altAdd === 'function') {
      await altAdd(inst, el);
      try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(inst.annotationUID, true); } catch {}
      recordAttachment(inst.annotationUID, el);
      return true;
    }

    // Last resort: try calling addAnnotation non-async if available
    try { (csAnnotation.state as any)?.addAnnotation?.(inst, el); } catch {}
    try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(inst.annotationUID, true); } catch {}
    recordAttachment(inst.annotationUID, el);
    return true;
  } catch (err) {
    // swallow - best-effort
    try { (csAnnotation.state as any)?.addAnnotation?.(inst, el); } catch {}
    try { recordAttachment(inst.annotationUID, el); } catch {}
    return false;
  }
}

/**
 * Return annotations attached to a specific element (wrapper).
 */
export function safeGetAnnotations(toolName: string | undefined, el: HTMLDivElement | null): any[] {
  try {
    return (csAnnotation.state?.getAnnotations?.(toolName as any, el as any) ?? []) as any[];
  } catch {
    try {
      return (csAnnotation.state?.getAnnotations?.(undefined as any, el as any) ?? []) as any[];
    } catch {
      return [];
    }
  }
}

export function safeGetAnnotationInstance(annotationUID: string): any | null {
  try {
    return (csAnnotation.state as any)?.getAnnotation?.(annotationUID) ?? null;
  } catch {
    return null;
  }
}

/**
 * Comprehensive removal: tries to remove an annotation instance from all known attached elements,
 * tries many API shapes (by uid or by instance), toggles visibility off, and clears the global map.
 *
 * Additionally: mark the UID as recently removed to avoid immediate re-attachment races.
 */
export async function safeRemoveAnnotationByUID(annotationUID: string): Promise<boolean> {
  if (!annotationUID) return false;

  // Mark as recently removed to prevent immediate re-attachment attempts from other effects.
  try {
    const recent = getRecentlyRemovedSet();
    recent.add(annotationUID);

    // keep it short — 1500..2500ms is usually enough to avoid re-attach race
    const timeoutMs = 2000;
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      window.setTimeout(() => {
        try { recent.delete(annotationUID); } catch {}
      }, timeoutMs);
    } else {
      // fallback: clear after a shorter period in non-browser env
      setTimeout(() => {
        try { recent.delete(annotationUID); } catch {}
      }, timeoutMs);
    }
  } catch {
    // swallow
  }

  try {
    const stateAny = csAnnotation.state as any;
    const vis = csAnnotation.visibility as any;

    // 0) If we have tracked elements, iterate them first (preferred)
    const attachedEls = listAttachmentElements(annotationUID);
    for (const el of attachedEls) {
      try {
        // Try to remove via state API by instance or uid
        let inst: any | null = null;
        try {
          inst = stateAny?.getAnnotation?.(annotationUID) ?? null;
        } catch {}

        // Try preferred candidate names that may accept instance or uid
        const candidates = ['removeAnnotation', 'deleteAnnotation', 'remove', 'delete'];
        let removedHere = false;
        for (const fnName of candidates) {
          try {
            const fn = stateAny?.[fnName];
            if (typeof fn === 'function') {
              // prefer passing instance if available
              const arg = inst ?? annotationUID;
              const res = fn.call(stateAny, arg);
              if (res && typeof res.then === 'function') await res;
              removedHere = true;
              break;
            }
          } catch {
            // continue trying other fnNames
          }
        }

        // If no removal function succeeded, try visibility toggle as soft-remove on that element
        try {
          vis?.setAnnotationVisibility?.(annotationUID, false);
        } catch {}

        // Attempt to remove any attached annotation returned by getAnnotations for that element
        try {
          const anns = stateAny?.getAnnotations?.(undefined, el) ?? [];
          if (Array.isArray(anns)) {
            for (const a of anns) {
              try {
                if (a?.annotationUID === annotationUID) {
                  for (const fnName of candidates) {
                    try {
                      const fn = stateAny?.[fnName];
                      if (typeof fn === 'function') {
                        const r = fn.call(stateAny, a);
                        if (r && typeof r.then === 'function') await r;
                        removedHere = true;
                        break;
                      }
                    } catch {}
                  }
                }
              } catch {}
            }
          }
        } catch {}
      } catch {}
    }

    // Clear tracked attachments for this uid (we attempted to remove from them)
    try { removeAttachmentRecord(annotationUID); } catch {}

    // 1) Try global state-level removal as a last resort (maybe library stores global list)
    try {
      const candidates = ['removeAnnotation', 'deleteAnnotation', 'remove', 'delete'];
      for (const fnName of candidates) {
        try {
          const fn = stateAny?.[fnName];
          if (typeof fn === 'function') {
            const res = fn.call(stateAny, annotationUID);
            if (res && typeof res.then === 'function') await res;
            try { vis?.setAnnotationVisibility?.(annotationUID, false); } catch {}
          }
        } catch {
          // ignore and continue
        }
      }
    } catch {}

    // 2) Ensure visibility is off anywhere
    try { (csAnnotation.visibility as any)?.setAnnotationVisibility?.(annotationUID, false); } catch {}

    // 3) Final: attempt to remove instance if remaining
    try {
      const inst = stateAny?.getAnnotation?.(annotationUID) ?? null;
      if (inst) {
        const candidates = ['removeAnnotation', 'deleteAnnotation', 'remove', 'delete'];
        for (const fnName of candidates) {
          try {
            const fn = stateAny?.[fnName];
            if (typeof fn === 'function') {
              const res = fn.call(stateAny, inst);
              if (res && typeof res.then === 'function') await res;
            }
          } catch {}
        }
      }
    } catch {}

    return true;
  } catch (err) {
    // swallow errors
    return false;
  }
}

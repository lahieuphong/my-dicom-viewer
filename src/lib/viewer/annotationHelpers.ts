// src/lib/viewer/annotationHelpers.ts
'use client';

import { annotation as csAnnotation } from '@cornerstonejs/tools';

/**
 * Centralized annotation lifecycle helpers.
 * - Avoid duplicate adds by checking existing annotations on target element first.
 * - Preserve visibility unless the caller explicitly owns a visibility update.
 * - Prevent an async attach flow from resurrecting a deleted annotation.
 * - Verify that Cornerstone actually removed an annotation before reporting success.
 *
 * Note: We use a global map `window.__annotationAttachments` to track which DOM elements (by
 * reference) an annotationUID was associated with. Cornerstone annotation state itself is global.
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

/**
 * Session tombstones prevent stale async selectors/bridges from re-adding a
 * deleted UID. Drawing-tool UIDs are unique, so a deleted UID must not be
 * reused during the current viewer session.
 */
function getRemovedAnnotationTombstones(): Set<string> {
  try {
    const w: any = typeof window !== 'undefined' ? (window as any) : null;
    if (!w) return new Set();
    if (
      !w.__removedAnnotationTombstones ||
      !(w.__removedAnnotationTombstones instanceof Set)
    ) {
      w.__removedAnnotationTombstones = new Set();
    }
    return w.__removedAnnotationTombstones as Set<string>;
  } catch {
    if (!(getRemovedAnnotationTombstones as any)._fallback) {
      (getRemovedAnnotationTombstones as any)._fallback = new Set();
    }
    return (getRemovedAnnotationTombstones as any)._fallback as Set<string>;
  }
}

export function isAnnotationRemovalTombstoned(annotationUID: string): boolean {
  return Boolean(annotationUID) && getRemovedAnnotationTombstones().has(annotationUID);
}

function applyVisibilityOverride(
  annotationUID: string,
  visible: boolean | undefined
): void {
  if (typeof visible !== 'boolean') return;
  try {
    (csAnnotation.visibility as any)?.setAnnotationVisibility?.(
      annotationUID,
      visible
    );
  } catch {
    // Visibility reconciliation will retry from useMeasurementBridge.
  }
}

/**
 * Best-effort: add annotation instance to element only if not already attached there.
 * Records the attachment in the global map.
 *
 * Visibility is intentionally opt-in. Navigation/selection callers must not
 * overwrite a newer hide/show decision; useMeasurementBridge is the owner.
 */
export async function safeAddAnnotation(
  inst: any,
  el: HTMLDivElement | null,
  options?: { visible?: boolean }
): Promise<boolean> {
  if (!inst || !el) return false;

  const annotationUID = String(inst.annotationUID ?? '');
  if (!annotationUID) return false;

  if (isAnnotationRemovalTombstoned(annotationUID)) return false;

  try {
    // Annotation state is global. If the UID is already registered, calling
    // addAnnotation again creates a duplicate entry in Cornerstone.
    let registered: any = null;
    try {
      registered =
        (csAnnotation.state as any)?.getAnnotation?.(annotationUID) ?? null;
    } catch {}
    if (registered) {
      applyVisibilityOverride(annotationUID, options?.visible);
      recordAttachment(annotationUID, el);
      return true;
    }

    // Compatibility fallback for state implementations without getAnnotation.
    try {
      const toolName = inst?.metadata?.toolName ?? inst?.toolName;
      const anns = safeGetAnnotations(toolName, el);
      if (anns.some((annotation) => annotation?.annotationUID === annotationUID)) {
        applyVisibilityOverride(annotationUID, options?.visible);
        recordAttachment(annotationUID, el);
        return true;
      }
    } catch {
      // ignore getAnnotations failures
    }

    // Primary preferred API
    const add = (csAnnotation.state as any)?.addAnnotation;
    if (typeof add === 'function') {
      await add(inst, el);
      if (isAnnotationRemovalTombstoned(annotationUID)) {
        try {
          (csAnnotation.state as any)?.removeAnnotation?.(annotationUID);
        } catch {}
        return false;
      }
      applyVisibilityOverride(annotationUID, options?.visible);
      recordAttachment(annotationUID, el);
      return true;
    }

    // Fallback shapes
    const altAdd = (csAnnotation.state as any)?.add ?? (csAnnotation as any)?.add;
    if (typeof altAdd === 'function') {
      await altAdd(inst, el);
      if (isAnnotationRemovalTombstoned(annotationUID)) {
        try {
          (csAnnotation.state as any)?.removeAnnotation?.(annotationUID);
        } catch {}
        return false;
      }
      applyVisibilityOverride(annotationUID, options?.visible);
      recordAttachment(annotationUID, el);
      return true;
    }

    return false;
  } catch {
    // An add can throw after partially mutating state. Verify by UID, but never
    // retry the mutation here because that can duplicate the annotation.
    try {
      const registered =
        (csAnnotation.state as any)?.getAnnotation?.(annotationUID) ?? null;
      if (registered) {
        if (isAnnotationRemovalTombstoned(annotationUID)) {
          try {
            (csAnnotation.state as any)?.removeAnnotation?.(annotationUID);
          } catch {}
          return false;
        }
        applyVisibilityOverride(annotationUID, options?.visible);
        recordAttachment(annotationUID, el);
        return true;
      }
    } catch {}
    return false;
  }
}

function normalizeAnnotations(result: any): any[] {
  if (!result) return [];
  if (Array.isArray(result)) return result;
  if (result instanceof Map) {
    return Array.from(result.values()).flatMap((value) =>
      Array.isArray(value) ? value : value ? [value] : []
    );
  }
  if (typeof result === 'object') {
    return Object.values(result).flatMap((value) =>
      Array.isArray(value) ? value : value ? [value] : []
    );
  }
  return [];
}

/**
 * Return annotations attached to a specific element (wrapper).
 */
export function safeGetAnnotations(toolName: string | undefined, el: HTMLDivElement | null): any[] {
  try {
    return normalizeAnnotations(
      csAnnotation.state?.getAnnotations?.(toolName as any, el as any)
    );
  } catch {
    try {
      return normalizeAnnotations(
        csAnnotation.state?.getAnnotations?.(undefined as any, el as any)
      );
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
 * Idempotently remove an annotation through Cornerstone's public UID API.
 *
 * Showing before removal clears Cornerstone's private hidden-UID registry. If
 * that registry is left behind, re-importing the same UID can create an
 * annotation that is permanently invisible.
 */
export async function safeRemoveAnnotationByUID(annotationUID: string): Promise<boolean> {
  if (!annotationUID) return false;

  const tombstones = getRemovedAnnotationTombstones();
  tombstones.add(annotationUID);
  const state = csAnnotation.state as any;
  const visibility = csAnnotation.visibility as any;
  let wasVisible: boolean | undefined;
  let wasSelected = false;

  try {
    wasVisible = visibility?.isAnnotationVisible?.(annotationUID);
  } catch {}
  try {
    wasSelected = Boolean(
      (csAnnotation.selection as any)?.isAnnotationSelected?.(annotationUID)
    );
  } catch {}

  const rollbackRemoval = () => {
    tombstones.delete(annotationUID);
    if (wasVisible === false) {
      try {
        if (state?.getAnnotation?.(annotationUID)) {
          visibility?.setAnnotationVisibility?.(annotationUID, false);
        }
      } catch {}
    }
    if (wasSelected && wasVisible !== false) {
      try {
        (csAnnotation.selection as any)?.setAnnotationSelected?.(
          annotationUID,
          true,
          false
        );
      } catch {}
    }
  };

  try {
    try {
      if (wasSelected) {
        (csAnnotation.selection as any)?.setAnnotationSelected?.(
          annotationUID,
          false
        );
      }
    } catch {}

    // Clear Cornerstone's hidden UID set while the annotation still exists.
    try {
      visibility?.setAnnotationVisibility?.(annotationUID, true);
    } catch {}

    const existing = state?.getAnnotation?.(annotationUID) ?? null;
    if (existing) {
      const remove = state?.removeAnnotation;
      if (typeof remove !== 'function') {
        rollbackRemoval();
        return false;
      }

      const result = remove.call(state, annotationUID);
      if (result && typeof result.then === 'function') {
        await result;
      }
    }

    const removed = !(state?.getAnnotation?.(annotationUID) ?? null);
    if (!removed) {
      rollbackRemoval();
      return false;
    }

    removeAttachmentRecord(annotationUID);
    return true;
  } catch {
    // Some managers can mutate state and then throw while dispatching an
    // event. Trust the postcondition instead of reporting a false failure.
    try {
      if (!(state?.getAnnotation?.(annotationUID) ?? null)) {
        removeAttachmentRecord(annotationUID);
        return true;
      }
    } catch {}

    // A genuine failed removal must remain retryable.
    rollbackRemoval();
    return false;
  }
}

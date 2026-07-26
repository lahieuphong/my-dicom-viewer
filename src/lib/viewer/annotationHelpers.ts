// src/lib/viewer/annotationHelpers.ts
'use client';

import { annotation as csAnnotation } from '@cornerstonejs/tools';

/**
 * Centralized annotation lifecycle helpers.
 * - Avoid duplicate adds by checking existing annotations on target element first.
 * - Preserve visibility unless the caller explicitly owns a visibility update.
 * - Prevent an async attach flow from resurrecting a deleted annotation.
 * - Verify that Cornerstone actually removed an annotation before reporting success.
 */

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
      return true;
    }

    // Cornerstone 3.x public annotation-state API.
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
        return true;
      }
    } catch {}
    return false;
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

    return true;
  } catch {
    // Some managers can mutate state and then throw while dispatching an
    // event. Trust the postcondition instead of reporting a false failure.
    try {
      if (!(state?.getAnnotation?.(annotationUID) ?? null)) {
        return true;
      }
    } catch {}

    // A genuine failed removal must remain retryable.
    rollbackRemoval();
    return false;
  }
}

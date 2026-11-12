// src/lib/cornerstone/annotations.ts
import { eventTarget } from '@cornerstonejs/core';
import {
  annotation as csAnnotation,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';

function getRegisteredAnnotation(annotationUID: string) {
  try {
    return csAnnotation.state.getAnnotation?.(annotationUID) ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves with the annotation once it is in Cornerstone's annotation state,
 * or with null after `timeout` ms. Every way an annotation gets there (a tool
 * drawing it, SR hydration, safeAddAnnotation) goes through
 * annotation.state.addAnnotation, which registers it and then dispatches
 * ANNOTATION_ADDED; this used to poll the state instead. The state is checked
 * once more at the timeout, because Cornerstone dispatches no event for a
 * tool that is in no tool group.
 */
export function ensureAnnotationAvailable(
  annotationUID: string,
  timeout = 2000
): Promise<any | null> {
  const existing = getRegisteredAnnotation(annotationUID);
  if (existing || timeout <= 0) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (found: any | null) => {
      if (settled) return;
      settled = true;
      eventTarget.removeEventListener(
        ToolEnums.Events.ANNOTATION_ADDED,
        onAnnotationAdded
      );
      window.clearTimeout(timer);
      resolve(found);
    };
    const onAnnotationAdded = (event: Event) => {
      const added = (event as CustomEvent<{ annotation?: any }>).detail
        ?.annotation;
      if (added?.annotationUID !== annotationUID) return;
      finish(getRegisteredAnnotation(annotationUID) ?? added);
    };

    eventTarget.addEventListener(
      ToolEnums.Events.ANNOTATION_ADDED,
      onAnnotationAdded
    );
    const timer = window.setTimeout(
      () => finish(getRegisteredAnnotation(annotationUID)),
      timeout
    );
  });
}

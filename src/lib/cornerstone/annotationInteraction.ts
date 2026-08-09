'use client';

import {
  annotation as cornerstoneAnnotation,
  cancelActiveManipulations,
  state as cornerstoneToolsState,
  ToolGroupManager,
} from '@cornerstonejs/tools';

type ActiveAnnotationInteraction = {
  annotation: any;
  isNewAnnotation: boolean;
  isDrawing: boolean;
};

/** Safely end the current draw/edit gesture before changing viewer modes. */
export function cancelActiveAnnotationInteraction(
  element: HTMLDivElement | null | undefined
): void {
  if (!element) return;
  if (
    !cornerstoneToolsState.isInteractingWithTool &&
    !cornerstoneToolsState.isMultiPartToolActive
  ) {
    return;
  }

  // CobbAngleTool appends both second-line handles on pointer-down. Its native
  // cancel() therefore sees four handles and emits COMPLETED even though that
  // line has not been released. Remember these drafts and remove them after
  // native cancel has torn down its DOM listeners and interaction state.
  const cobbDrafts = getActiveAnnotationInteractions().filter(
    ({ annotation, isNewAnnotation, isDrawing }) =>
      isNewAnnotation &&
      isDrawing &&
      annotation?.metadata?.toolName === 'CobbAngle'
  );
  for (const { annotation } of cobbDrafts) {
    const points = annotation?.data?.handles?.points;
    if (Array.isArray(points) && points.length >= 4) {
      annotation.data.handles.points = points.slice(0, 2);
    }
  }

  try {
    cancelActiveManipulations(element);
  } catch {}

  for (const { annotation } of cobbDrafts) {
    const annotationUID = String(annotation?.annotationUID ?? '');
    if (!annotationUID) continue;
    try {
      cornerstoneAnnotation.state.removeAnnotation(annotationUID);
    } catch {}
  }
}

function getActiveAnnotationInteractions(): ActiveAnnotationInteraction[] {
  try {
    const groups = ToolGroupManager.getAllToolGroups?.() ?? [];
    return groups.flatMap((group: any) =>
      Object.values(group?.getToolInstances?.() ?? {})
        .flatMap((instance: any) => {
          const interactions: ActiveAnnotationInteraction[] = [];
          const editAnnotation = instance?.editData?.annotation;
          const freehandAnnotation = instance?.commonData?.annotation;

          if (editAnnotation?.annotationUID) {
            interactions.push({
              annotation: editAnnotation,
              isNewAnnotation: Boolean(instance.editData?.newAnnotation),
              isDrawing: Boolean(instance?.isDrawing),
            });
          }

          // PlanarFreehandROITool keeps its active annotation in commonData
          // and the creation flag in drawData instead of editData.
          if (
            freehandAnnotation?.annotationUID &&
            freehandAnnotation !== editAnnotation
          ) {
            interactions.push({
              annotation: freehandAnnotation,
              isNewAnnotation: Boolean(instance.drawData?.newAnnotation),
              isDrawing: Boolean(instance?.isDrawing),
            });
          }

          return interactions;
        })
    );
  } catch {
    return [];
  }
}

/**
 * Cornerstone adds a new annotation to global state before the drawing tool
 * emits ANNOTATION_COMPLETED. This identifies that short-lived draft without
 * relying on geometry heuristics that vary between measurement tools.
 */
export function isAnnotationCreationInProgress(
  annotationUID: string
): boolean {
  if (!annotationUID) return false;

  return getActiveAnnotationInteractions().some(
    ({ annotation, isNewAnnotation, isDrawing }) =>
      String(annotation.annotationUID) === annotationUID &&
      isNewAnnotation &&
      (isDrawing ||
        cornerstoneToolsState.isInteractingWithTool ||
        cornerstoneToolsState.isMultiPartToolActive)
  );
}

/**
 * SR creation must snapshot a settled annotation state. This covers both a
 * new multi-click drawing and a handle modification already in progress.
 */
export function hasActiveAnnotationInteraction(): boolean {
  if (
    !cornerstoneToolsState.isInteractingWithTool &&
    !cornerstoneToolsState.isMultiPartToolActive
  ) {
    return false;
  }

  return getActiveAnnotationInteractions().length > 0;
}

'use client';

import {
  state as cornerstoneToolsState,
  ToolGroupManager,
} from '@cornerstonejs/tools';

function getActiveAnnotationEditData(): any[] {
  try {
    const groups = ToolGroupManager.getAllToolGroups?.() ?? [];
    return groups.flatMap((group: any) =>
      Object.values(group?.getToolInstances?.() ?? {})
        .map((instance: any) => ({
          editData: instance?.editData,
          isDrawing: Boolean(instance?.isDrawing),
        }))
        .filter(({ editData }) => editData?.annotation?.annotationUID)
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

  return getActiveAnnotationEditData().some(
    ({ editData, isDrawing }) =>
      String(editData.annotation.annotationUID) === annotationUID &&
      Boolean(editData.newAnnotation) &&
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

  return getActiveAnnotationEditData().length > 0;
}

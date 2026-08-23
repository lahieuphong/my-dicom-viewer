'use client';

import {
  WindowLevelRegionTool as CornerstoneWindowLevelRegionTool,
  annotation as csAnnotation,
  cursors,
  utilities as toolUtilities,
} from '@cornerstonejs/tools';

/**
 * Native WindowLevelRegion with deterministic cancellation.
 *
 * Cornerstone 3.33.5 intentionally removes the transient rectangle after a
 * completed drag, but its native cancel() is a no-op. Cleaning the draft here
 * prevents an interrupted drag (tool switch, Cine, dialog) from leaving input
 * listeners or an invisible annotation active on the viewport.
 */
export class WindowLevelRegionTool extends CornerstoneWindowLevelRegionTool {
  static toolName = CornerstoneWindowLevelRegionTool.toolName;

  constructor(
    ...args: ConstructorParameters<typeof CornerstoneWindowLevelRegionTool>
  ) {
    super(...args);

    let activeElement: HTMLDivElement | null = null;
    const nativeAddNewAnnotation = this.addNewAnnotation;
    const nativeEndCallback = this._endCallback;

    this.addNewAnnotation = (evt) => {
      activeElement = evt.detail.element;
      return nativeAddNewAnnotation(evt);
    };

    this._endCallback = (evt) => {
      try {
        nativeEndCallback(evt);
      } finally {
        activeElement = null;
      }
    };

    this.cancel = () => {
      if (!this.isDrawing || !this.editData || !activeElement) return;

      const { annotation, viewportIdsToRender } = this.editData;
      const annotationUID = String(annotation.annotationUID ?? '');

      this._deactivateDraw(activeElement);
      cursors.elementCursor.resetElementCursor(activeElement);
      this.editData = null;
      this.isDrawing = false;
      activeElement = null;

      if (annotationUID) {
        try {
          csAnnotation.state.removeAnnotation(annotationUID);
        } catch {}
      }
      try {
        toolUtilities.triggerAnnotationRenderForViewportIds(
          viewportIdsToRender
        );
      } catch {}
    };
  }
}

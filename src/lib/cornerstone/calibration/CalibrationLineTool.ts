'use client';

import type { Types as CoreTypes } from '@cornerstonejs/core';
import {
  LengthTool,
  annotation as cornerstoneAnnotation,
  utilities as toolUtilities,
  type Types as ToolTypes,
} from '@cornerstonejs/tools';

type CalibrationLineData = {
  handles?: {
    points?: CoreTypes.Point3[];
  };
};

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * OHIF-compatible calibration line for Cornerstone Tools 3.33.x.
 *
 * It deliberately shows canvas pixels while drawing. The physical distance is
 * requested by the dialog after completion, and the annotation is then
 * discarded instead of becoming a reportable Length measurement.
 */
export default class CalibrationLineTool extends LengthTool {
  static toolName = 'CalibrationLine';

  private renderingViewport: CoreTypes.IViewport | null = null;

  constructor(toolProps: ToolTypes.PublicToolProps = {}) {
    super(toolProps);

    const renderLengthAnnotation = this.renderAnnotation;
    this.renderAnnotation = (enabledElement, svgDrawingHelper) => {
      this.renderingViewport = enabledElement.viewport;
      return renderLengthAnnotation(enabledElement, svgDrawingHelper);
    };

    // LengthTool 3.33.x reads configuration.getTextLines. Newer OHIF source
    // overrides _getTextLines instead, which is not called by this version.
    this.configuration = {
      ...this.configuration,
      getTextLines: (data: CalibrationLineData) =>
        this.getCalibrationTextLines(data),
    };

    // Native LengthTool.cancel() emits ANNOTATION_COMPLETED for a new draft.
    // Remove that draft synchronously so the deferred dialog listener can
    // distinguish a real pointer-up completion from Escape/tool switching.
    const cancelLengthAnnotation = this.cancel;
    this.cancel = (element) => {
      const draftUID = this.editData?.newAnnotation
        ? String(this.editData.annotation?.annotationUID ?? '')
        : '';
      const annotationUID = cancelLengthAnnotation(element);

      if (draftUID) {
        try {
          cornerstoneAnnotation.state.removeAnnotation(draftUID);
          toolUtilities.triggerAnnotationRender(element);
        } catch {}
      }

      return annotationUID;
    };
  }

  /** A transient calibration guide must never enter annotation undo/redo. */
  protected createMemo(): void {
    // LengthTool calls this while dragging. Persisting that memo would allow
    // Redo to resurrect the guide after Save/Cancel removed it.
  }

  private getCalibrationTextLines(data: CalibrationLineData): string[] {
    const points = data.handles?.points;
    const viewport = this.renderingViewport;
    if (!viewport || !points || points.length < 2) return [];

    const point1 = viewport.worldToCanvas(points[0]);
    const point2 = viewport.worldToCanvas(points[1]);
    const dx = point1[0] - point2[0];
    const dy = point1[1] - point2[1];
    const lengthInPixels = roundToTwo(Math.hypot(dx, dy));

    return Number.isFinite(lengthInPixels) ? [`${lengthInPixels}px`] : [];
  }
}

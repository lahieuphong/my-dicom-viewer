// Removal of one measurement, independent of React and Cornerstone.

export type MeasurementRemovalSteps = {
  /** Removes the annotation from Cornerstone; false when it could not. */
  removeAnnotation: (annotationUID: string) => Promise<boolean>;
  /** Whether Cornerstone still has the annotation. */
  hasAnnotation: (annotationUID: string) => boolean;
  getSelectedUID: () => string | null;
  setSelectedUID: (annotationUID: string | null) => void;
  /** Forgets a selection of the measurement that is queued but not started. */
  dropPendingSelection: (annotationUID: string) => void;
  /** Updates what lists, styles or renders the removed measurement. */
  forgetRemoved: (annotationUID: string) => void;
};

/**
 * Removes a measurement and resolves with whether it was removed. Its
 * selection, current or queued, is dropped first, so nothing navigates to an
 * annotation that is going away. When the removal fails while Cornerstone
 * still has the annotation, a current selection comes back.
 */
export async function removeMeasurement(
  annotationUID: string,
  steps: MeasurementRemovalSteps
): Promise<boolean> {
  const wasSelected = steps.getSelectedUID() === annotationUID;
  const restoreSelection = () => {
    if (wasSelected && steps.hasAnnotation(annotationUID)) {
      steps.setSelectedUID(annotationUID);
    }
  };

  try {
    steps.dropPendingSelection(annotationUID);
    if (wasSelected) steps.setSelectedUID(null);

    if (!(await steps.removeAnnotation(annotationUID))) {
      restoreSelection();
      return false;
    }

    steps.forgetRemoved(annotationUID);
    return true;
  } catch {
    restoreSelection();
    return false;
  }
}

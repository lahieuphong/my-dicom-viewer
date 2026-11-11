// Measurement visibility for the basic-viewer mode.
'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The set of measurements the user hid in the Measurement panel. It belongs
 * to a study and is cleared when the study changes. A measurement that is
 * being removed cannot be toggled any more.
 */
export function useHiddenMeasurements(
  studyUID: string,
  isRemoved: (annotationUID: string) => boolean
) {
  const [hiddenMeasurements, setHiddenMeasurements] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    setHiddenMeasurements(new Set());
  }, [studyUID]);

  const toggleVisibility = useCallback(
    (annotationUID: string) => {
      if (!annotationUID || isRemoved(annotationUID)) return;

      setHiddenMeasurements((previous) => {
        const next = new Set(previous);
        if (next.has(annotationUID)) {
          next.delete(annotationUID);
        } else {
          next.add(annotationUID);
        }
        return next;
      });
    },
    [isRemoved]
  );

  /** Drops a removed measurement from the set. */
  const forgetMeasurement = useCallback((annotationUID: string) => {
    setHiddenMeasurements((previous) => {
      if (!previous.has(annotationUID)) return previous;
      const next = new Set(previous);
      next.delete(annotationUID);
      return next;
    });
  }, []);

  return { hiddenMeasurements, toggleVisibility, forgetMeasurement };
}

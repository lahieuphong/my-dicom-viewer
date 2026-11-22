// The study's display metadata for the basic-viewer mode.
'use client';

import { useEffect, useState } from 'react';

import { fetchStudyMeta } from '@/extensions/static-dicom-data-source';
import type { Study } from '@/platform/core';

function createFallbackStudyMeta(studyUID: string): Study {
  return {
    studyInstanceUID: studyUID,
    patientName: '-',
    patientId: '-',
    studyDate: '-',
    studyDescription: studyUID,
    accessionNumber: '-',
    modalitiesInStudy: '-',
    seriesCount: 0,
    imageCount: 0,
    series: [],
  };
}

/**
 * The study's metadata from the data source. A placeholder (the UID as the
 * description) stands in while it loads, when it fails and right after the
 * study changes.
 */
export function useStudyMeta(studyUID: string): Study {
  const [studyMeta, setStudyMeta] = useState<Study>(() =>
    createFallbackStudyMeta(studyUID)
  );

  useEffect(() => {
    let cancelled = false;
    setStudyMeta(createFallbackStudyMeta(studyUID));

    fetchStudyMeta(studyUID)
      .then((meta) => {
        if (!cancelled && meta) {
          setStudyMeta(meta);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [studyUID]);

  return studyMeta;
}

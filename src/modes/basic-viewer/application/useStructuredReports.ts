// The structured reports of the basic-viewer mode's study.
'use client';

import { useEffect, useState } from 'react';

import type { LocalStructuredReport } from '@/platform/core';

/**
 * The SRs made in this session and the one open (its measurements are the
 * ones listed, and the series is read-only while it is open). Both reset
 * when the study changes.
 */
export function useStructuredReports(studyUID: string) {
  const [loadedSrList, setLoadedSrList] = useState<LocalStructuredReport[]>([]);
  const [activeSrId, setActiveSrId] = useState<string | null>(null);

  useEffect(() => {
    setLoadedSrList([]);
    setActiveSrId(null);
  }, [studyUID]);

  return { loadedSrList, setLoadedSrList, activeSrId, setActiveSrId };
}

'use client';

import { useCallback, useEffect, useRef } from 'react';
import { saveAs } from 'file-saver';
import { annotation as csAnnotation } from '@cornerstonejs/tools';

import type { AnnotationMeasurement } from '@/hooks/useMeasurements';
import { releaseMeasurementAnnotationStyle } from '@/lib/cornerstone/measurementStyles';
import { safeRemoveAnnotationByUID } from '@/lib/viewer/annotationHelpers';
import type { Series } from '@/platform/core';

import {
  buildStructuredReport,
  type GeneratedStructuredReport,
  type SRMeasurement,
} from './generator';
import { datasetToDicomPart10Blob } from './dicomWriter';
import {
  hydrateStructuredReportForLocalViewer,
  type HydratedLocalSrMeasurement,
} from './hydration';
import {
  collectSrMeasurementSnapshot,
  StaleMeasurementSnapshotError,
} from './measurementSnapshot';

type SeriesMapEntry = { files: string[]; metadata: Series };

type LoadedSrEntry = {
  id: string;
  label: string;
  count: number;
  instances: any[];
};

type UseSrExportDeps = {
  allMeasurements: AnnotationMeasurement[];
  mergedSeriesMap: Record<string, SeriesMapEntry>;
  mergedSeriesMapRef?: {
    current: Record<string, SeriesMapEntry>;
  };
  setExtraSeriesMap: (
    updater: (
      previous: Record<string, SeriesMapEntry>
    ) => Record<string, SeriesMapEntry>
  ) => void;
  setAllMeasurements: (
    measurements:
      | AnnotationMeasurement[]
      | ((
          previous: AnnotationMeasurement[]
        ) => AnnotationMeasurement[])
  ) => void;
  refreshMeasurements?: () => void;
  setLoadedSrList: (
    updater: (previous: LoadedSrEntry[]) => LoadedSrEntry[]
  ) => void;
  studyUID: string;
  trackedSeriesUID: string;
  viewportId: string;
};

function assertExportIsCurrent(
  generationRef: { current: number },
  expectedGeneration: number,
  activeStudyUIDRef: { current: string },
  expectedStudyUID: string
): void {
  if (
    generationRef.current !== expectedGeneration ||
    activeStudyUIDRef.current !== expectedStudyUID
  ) {
    throw new Error(
      'Structured Report creation was cancelled because the active study changed.'
    );
  }
}

function disposeLocalAnnotations(annotationUIDs: Iterable<string>): void {
  for (const uid of annotationUIDs) {
    void safeRemoveAnnotationByUID(uid);
    releaseMeasurementAnnotationStyle(uid);
  }
}

function sanitizeFileName(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

function getNextSrSeriesNumber(
  seriesMap: Record<string, SeriesMapEntry>
): number {
  // OHIF reserves 3000 as the new-report sentinel and writes the first SR as
  // 3001 (`SeriesNumber = 1 + priorSeriesNumber`).
  let highest = 3000;

  for (const entry of Object.values(seriesMap)) {
    if (entry?.metadata?.seriesModality !== 'SR') continue;
    const parsed = Number(entry.metadata.seriesNumber);
    if (Number.isFinite(parsed)) highest = Math.max(highest, parsed);
  }

  return highest + 1;
}

function createReferencedImageStack(
  report: GeneratedStructuredReport,
  seriesMap: Record<string, SeriesMapEntry>
): string[] {
  const imageIds: string[] = [];
  const seen = new Set<string>();

  for (const seriesUID of report.sourceSeriesInstanceUIDs) {
    for (const imageId of seriesMap[seriesUID]?.files ?? []) {
      if (seen.has(imageId)) continue;
      seen.add(imageId);
      imageIds.push(imageId);
    }
  }

  for (const imageId of report.sourceImageIds) {
    if (seen.has(imageId)) continue;
    seen.add(imageId);
    imageIds.push(imageId);
  }

  return imageIds;
}

function addHydratedAnnotations(
  hydrated: HydratedLocalSrMeasurement[]
): string[] {
  const added: string[] = [];

  try {
    for (const item of hydrated) {
      const uid = item.annotation.annotationUID;
      (csAnnotation.state as any).addAnnotation(item.annotation);
      added.push(uid);
      csAnnotation.locking.setAnnotationLocked(uid, true);
      csAnnotation.visibility.setAnnotationVisibility(uid, false);
    }
    return added;
  } catch (error) {
    disposeLocalAnnotations(added);
    throw error;
  }
}

export function useSrExport({
  allMeasurements,
  mergedSeriesMap,
  mergedSeriesMapRef,
  setExtraSeriesMap,
  setAllMeasurements,
  refreshMeasurements,
  setLoadedSrList,
  studyUID,
  trackedSeriesUID,
  viewportId,
}: UseSrExportDeps) {
  const exportInFlightRef = useRef<Promise<string[] | null> | null>(null);
  const localSrAnnotationsBySeriesRef = useRef<
    Map<string, Set<string>>
  >(new Map());
  const lifecycleGenerationRef = useRef(0);
  const activeStudyUIDRef = useRef(studyUID);
  activeStudyUIDRef.current = studyUID;

  useEffect(() => {
    const generation = ++lifecycleGenerationRef.current;

    return () => {
      if (lifecycleGenerationRef.current === generation) {
        lifecycleGenerationRef.current += 1;
      }
      exportInFlightRef.current = null;
      for (const annotationUIDs of localSrAnnotationsBySeriesRef.current.values()) {
        disposeLocalAnnotations(annotationUIDs);
      }
      localSrAnnotationsBySeriesRef.current.clear();
    };
  }, [studyUID]);

  const collectMeasurementSnapshot = useCallback((): SRMeasurement[] => {
    /**
     * This mirrors OHIF's StudyInstanceUID + tracked SeriesInstanceUID
     * measurement filter. Selection and visibility are intentionally not
     * predicates: every tracked measurement in that source series is exported.
     */
    return collectSrMeasurementSnapshot({
      allMeasurements,
      seriesMap: mergedSeriesMap,
      studyInstanceUID: studyUID,
      trackedSeriesInstanceUID: trackedSeriesUID,
      getAnnotation: (annotationUID) =>
        (csAnnotation.state as any).getAnnotation?.(annotationUID) ??
        null,
    });
  }, [
    allMeasurements,
    mergedSeriesMap,
    studyUID,
    trackedSeriesUID,
  ]);

  const registerLocalReport = useCallback(
    (
      report: GeneratedStructuredReport,
      title: string,
      hydrated: HydratedLocalSrMeasurement[],
      expectedGeneration: number,
      expectedStudyUID: string
    ): string[] => {
      assertExportIsCurrent(
        lifecycleGenerationRef,
        expectedGeneration,
        activeStudyUIDRef,
        expectedStudyUID
      );
      const dataset = report.dataset;
      const reportSeriesUID = String(dataset.SeriesInstanceUID);
      const reportImageIds = createReferencedImageStack(
        report,
        mergedSeriesMap
      );

      if (!reportImageIds.length) {
        throw new Error('The SR report has no resolvable source images.');
      }

      if (hydrated.length !== report.measurementGroupCount) {
        throw new Error(
          `Only ${hydrated.length}/${report.measurementGroupCount} SR measurements could be hydrated.`
        );
      }

      const seriesEntry: SeriesMapEntry = {
        files: reportImageIds,
        metadata: {
          seriesDescription:
            String(dataset.SeriesDescription ?? '').trim() || title,
          seriesInstanceUID: reportSeriesUID,
          seriesNumber: String(dataset.SeriesNumber ?? ''),
          seriesModality: 'SR',
          seriesRelatedInstanceCount: '1',
          instances: [
            {
              sopInstanceUID: String(dataset.SOPInstanceUID),
              instanceNumber: Number(dataset.InstanceNumber ?? 1),
              url: '',
            },
          ],
        },
      };

      const previousRefValue = mergedSeriesMapRef?.current;
      if (mergedSeriesMapRef) {
        mergedSeriesMapRef.current = {
          ...mergedSeriesMapRef.current,
          [reportSeriesUID]: seriesEntry,
        };
      }

      let addedAnnotationUIDs: string[] = [];
      try {
        addedAnnotationUIDs = addHydratedAnnotations(hydrated);
      } catch (error) {
        if (mergedSeriesMapRef && previousRefValue) {
          mergedSeriesMapRef.current = previousRefValue;
        }
        throw error;
      }

      try {
        setExtraSeriesMap((previous) => ({
          ...previous,
          [reportSeriesUID]: seriesEntry,
        }));

        setLoadedSrList((previous) => [
          ...previous.filter((item) => item.id !== reportSeriesUID),
          {
            id: reportSeriesUID,
            label:
              String(dataset.SeriesDescription ?? '').trim() || title,
            count: hydrated.length,
            instances: [
              {
                sopInstanceUID: String(dataset.SOPInstanceUID),
                SOPInstanceUID: dataset.SOPInstanceUID,
                SOPClassUID: dataset.SOPClassUID,
                SeriesInstanceUID: reportSeriesUID,
              },
            ],
          },
        ]);

        setAllMeasurements((previous) => {
          const byUID = new Map(
            previous.map((measurement) => [
              measurement.annotationUID,
              measurement,
            ])
          );
          for (const { measurement } of hydrated) {
            byUID.set(measurement.annotationUID, measurement);
          }
          return Array.from(byUID.values());
        });

        localSrAnnotationsBySeriesRef.current.set(
          reportSeriesUID,
          new Set(addedAnnotationUIDs)
        );
      } catch (error) {
        disposeLocalAnnotations(addedAnnotationUIDs);
        if (mergedSeriesMapRef && previousRefValue) {
          mergedSeriesMapRef.current = previousRefValue;
        }
        throw error;
      }

      refreshMeasurements?.();
      return [reportSeriesUID];
    },
    [
      mergedSeriesMap,
      mergedSeriesMapRef,
      refreshMeasurements,
      setAllMeasurements,
      setExtraSeriesMap,
      setLoadedSrList,
      studyUID,
      viewportId,
    ]
  );

  const rollbackLocalReport = useCallback(
    (
      reportSeriesUID: string,
      hydrated: HydratedLocalSrMeasurement[]
    ): void => {
      const annotationUIDs =
        localSrAnnotationsBySeriesRef.current.get(reportSeriesUID) ??
        new Set(
          hydrated.map((item) => item.measurement.annotationUID)
        );
      localSrAnnotationsBySeriesRef.current.delete(reportSeriesUID);
      disposeLocalAnnotations(annotationUIDs);

      if (mergedSeriesMapRef) {
        const next = { ...mergedSeriesMapRef.current };
        delete next[reportSeriesUID];
        mergedSeriesMapRef.current = next;
      }
      setExtraSeriesMap((previous) => {
        if (!previous[reportSeriesUID]) return previous;
        const next = { ...previous };
        delete next[reportSeriesUID];
        return next;
      });
      setLoadedSrList((previous) =>
        previous.filter((item) => item.id !== reportSeriesUID)
      );
      setAllMeasurements((previous) =>
        previous.filter(
          (measurement) => !annotationUIDs.has(measurement.annotationUID)
        )
      );
    },
    [
      mergedSeriesMapRef,
      setAllMeasurements,
      setExtraSeriesMap,
      setLoadedSrList,
    ]
  );

  const exportSRAsDICOM = useCallback(
    async (documentTitle?: string): Promise<string[] | null> => {
      if (exportInFlightRef.current) {
        throw new Error('A Structured Report is already being created.');
      }

      const operation = (async () => {
        const expectedGeneration = lifecycleGenerationRef.current;
        const expectedStudyUID = studyUID;
        const title = (
          String(documentTitle ?? '').trim() || 'Measurement Report'
        ).slice(0, 64);
        let measurements: SRMeasurement[];
        try {
          measurements = collectMeasurementSnapshot();
        } catch (error) {
          if (error instanceof StaleMeasurementSnapshotError) {
            refreshMeasurements?.();
          }
          throw error;
        }
        if (!measurements.length) {
          throw new Error(
            'There are no tracked measurements in this study to export.'
          );
        }
        assertExportIsCurrent(
          lifecycleGenerationRef,
          expectedGeneration,
          activeStudyUIDRef,
          expectedStudyUID
        );

        const report = await buildStructuredReport({
          studyInstanceUID: expectedStudyUID,
          measurements,
          seriesDescription: title,
          seriesNumber: getNextSrSeriesNumber(mergedSeriesMap),
          instanceNumber: 1,
        });
        assertExportIsCurrent(
          lifecycleGenerationRef,
          expectedGeneration,
          activeStudyUIDRef,
          expectedStudyUID
        );
        const expectedMeasurementUIDs = new Set(
          measurements.map((measurement) => measurement.uid)
        );
        if (
          report.exportedMeasurementUIDs.length !==
            expectedMeasurementUIDs.size ||
          report.exportedMeasurementUIDs.some(
            (annotationUID) =>
              !expectedMeasurementUIDs.has(annotationUID)
          )
        ) {
          throw new Error(
            'DICOM SR generation did not preserve the complete measurement snapshot.'
          );
        }

        const expectedSourceSeriesInstanceUID = String(
          mergedSeriesMap[trackedSeriesUID]?.metadata
            ?.seriesInstanceUID ?? trackedSeriesUID
        );
        if (
          report.sourceSeriesInstanceUIDs.length !== 1 ||
          report.sourceSeriesInstanceUIDs[0] !==
            expectedSourceSeriesInstanceUID
        ) {
          throw new Error(
            'The measurement snapshot references a different source series.'
          );
        }

        const reportImageIds = createReferencedImageStack(
          report,
          mergedSeriesMap
        );
        const hydrated = await hydrateStructuredReportForLocalViewer({
          dataset: report.dataset,
          reportImageIds,
          reportSeriesInstanceUID: String(
            report.dataset.SeriesInstanceUID
          ),
          studyInstanceUID: expectedStudyUID,
          viewportId,
        });
        assertExportIsCurrent(
          lifecycleGenerationRef,
          expectedGeneration,
          activeStudyUIDRef,
          expectedStudyUID
        );
        if (hydrated.length !== report.measurementGroupCount) {
          throw new Error(
            `Only ${hydrated.length}/${report.measurementGroupCount} SR measurements could be validated.`
          );
        }

        const safeTitle = sanitizeFileName(title) || 'report';
        const downloadBlob = await datasetToDicomPart10Blob(report.dataset);
        assertExportIsCurrent(
          lifecycleGenerationRef,
          expectedGeneration,
          activeStudyUIDRef,
          expectedStudyUID
        );
        const downloadFileName = `SR_${expectedStudyUID}_${safeTitle}.dcm`;

        const createdIds = registerLocalReport(
          report,
          title,
          hydrated,
          expectedGeneration,
          expectedStudyUID
        );

        try {
          assertExportIsCurrent(
            lifecycleGenerationRef,
            expectedGeneration,
            activeStudyUIDRef,
            expectedStudyUID
          );
          saveAs(downloadBlob, downloadFileName);
        } catch (error) {
          rollbackLocalReport(
            String(report.dataset.SeriesInstanceUID),
            hydrated
          );
          throw error;
        }
        return createdIds;
      })();

      exportInFlightRef.current = operation;
      try {
        return await operation;
      } finally {
        if (exportInFlightRef.current === operation) {
          exportInFlightRef.current = null;
        }
      }
    },
    [
      collectMeasurementSnapshot,
      mergedSeriesMap,
      registerLocalReport,
      rollbackLocalReport,
      refreshMeasurements,
      studyUID,
      trackedSeriesUID,
      viewportId,
    ]
  );

  return { exportSRAsDICOM };
}

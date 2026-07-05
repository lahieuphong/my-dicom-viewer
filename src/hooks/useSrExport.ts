// src/hooks/useSrExport.ts
'use client';
import { saveAs } from 'file-saver';
import { annotation as csAnnotation } from '@cornerstonejs/tools';
import { buildStructuredReport } from '@/lib/sr/generator';
import { getEnabledElement } from '@cornerstonejs/core';
import { enableElement } from '@/lib/cornerstone/element';
import type { StackViewport } from '@cornerstonejs/core';
import type { AnnotationMeasurement } from '@/hooks/useMeasurements';
import type { Series } from '@/lib/pacs/services';
import { normalizeId } from '@/lib/viewer/dom';

type UseSrExportDeps = {
  allMeasurements: AnnotationMeasurement[];
  mergedSeriesMap: Record<string, { files: string[]; metadata: Series }>;
  viewportInstance: StackViewport | null;
  viewportEl: HTMLDivElement | null;
  setExtraSeriesMap: (
    updater: (prev: Record<string, { files: string[]; metadata: Series }>) => Record<string, { files: string[]; metadata: Series }>
  ) => void;
  setAllMeasurements: (m: AnnotationMeasurement[] | ((prev: AnnotationMeasurement[]) => AnnotationMeasurement[])) => void;
  refreshMeasurements?: () => void;
  setLoadedSrList: (fn: (prev: any[]) => any[]) => void;
  setActiveSrId: (id: string | null) => void;
  setSelectedMeasurementUID: (id: string | null) => void;
  setCurrentFrame: (n: number) => void;
  renderingEngineRef: { current: any } | null;
  studyUID: string;
  viewportId: string;
  viewSr?: (seriesUID: string, instanceUID?: string | null) => Promise<any>;
};

export function useSrExport(deps: UseSrExportDeps) {
  const {
    allMeasurements,
    mergedSeriesMap,
    viewportInstance,
    viewportEl,
    setExtraSeriesMap,
    setAllMeasurements,
    refreshMeasurements,
    setLoadedSrList,
    setActiveSrId,
    setSelectedMeasurementUID,
    setCurrentFrame,
    renderingEngineRef,
    studyUID,
  } = deps;

  // tolerant alias to annotation state (many cs-tools versions)
  const stateAny = (csAnnotation as any).state as any;

  // ----------------- Helper functions -----------------
  function matchesSopOnId(id?: string | null, sop?: string | null) {
    if (!id || !sop) return false;
    const nid = normalizeId(id);
    const cand = String(sop).replace(/^imageId:/, '').split('/').pop();
    if (!cand) return false;
    return nid.includes(cand);
  }

  function makeNewAnnotationUID(origUID: string, srId: string) {
    const now = Date.now();
    const rnd = Math.random().toString(36).slice(2, 8);
    return `${srId}::${origUID}::${now}::${rnd}`;
  }
  // ----------------------------------------------------------

  function tryGetAnnotation(uid: string) {
    if (!stateAny) return null;
    try {
      if (typeof stateAny.getAnnotation === 'function') {
        return stateAny.getAnnotation(uid);
      }
      return (stateAny as any).getAnnotation?.(uid) ?? null;
    } catch (e) {
      return null;
    }
  }

  async function waitForAnnotation(uid: string, timeout = 2000, interval = 50) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const inst = tryGetAnnotation(uid);
      if (inst) return inst;
      await new Promise((r) => setTimeout(r, interval));
    }
    return null;
  }

  function tryLockAnnotationByUid(uid: string) {
    try {
      if ((csAnnotation as any).locking && typeof (csAnnotation as any).locking.setAnnotationLocked === 'function') {
        try { (csAnnotation as any).locking.setAnnotationLocked(uid, true); } catch (_) {}
      }
      if (stateAny && typeof stateAny.setAnnotationLocked === 'function') {
        try { stateAny.setAnnotationLocked(uid, true); } catch (_) {}
      }
      if (stateAny && typeof stateAny.lockAnnotation === 'function') {
        try { stateAny.lockAnnotation(uid, true); } catch (_) {}
      }
    } catch (e) {
      // ignore
    }
  }

  // ---- NEW: Force remove originals helper (robust across cs-tools versions) ----
  async function forceRemoveOriginalAnnotations(uidsToRemove: string[], el?: HTMLDivElement | null) {
    if (!stateAny) return;
    try {
      // find frameOfReferenceUID from enabled element or dataset
      let forUID: string | null = null;
      try {
        if (el) {
          const enabled = getEnabledElement(el) ?? (el as any).__enabledElement ?? null;
          if (enabled && enabled.viewport && typeof enabled.viewport.getFrameOfReferenceUID === 'function') {
            forUID = enabled.viewport.getFrameOfReferenceUID?.() ?? null;
          } else if ((el as any).dataset?.frameOfReferenceUID) {
            forUID = (el as any).dataset.frameOfReferenceUID ?? null;
          }
        }
      } catch (e) {
        // ignore
      }

      // if we don't have forUID and el exists, try enableElement() then re-read
      if (!forUID && el) {
        try {
          enableElement(el);
          const enabled = getEnabledElement(el) ?? null;
          if (enabled && enabled.viewport && typeof enabled.viewport.getFrameOfReferenceUID === 'function') {
            forUID = enabled.viewport.getFrameOfReferenceUID?.() ?? null;
            try { if (forUID) el.dataset.frameOfReferenceUID = forUID; } catch {}
          }
        } catch (e) {
          // ignore
        }
      }

      // 1) Call getAnnotations in the best-supported signature:
      let annsRaw: any = [];
      try {
        if (forUID && typeof stateAny.getAnnotations === 'function') {
          annsRaw = stateAny.getAnnotations(forUID) ?? [];
        } else if (typeof stateAny.getAnnotations === 'function') {
          try {
            annsRaw = stateAny.getAnnotations() ?? [];
          } catch (e) {
            annsRaw = [];
          }
        } else {
          annsRaw = [];
        }
      } catch (e) {
        try {
          annsRaw = (csAnnotation.state as any).getAnnotations?.(forUID) ?? (csAnnotation.state as any).getAnnotations?.() ?? [];
        } catch {
          annsRaw = [];
        }
      }

      // Normalize to flat array
      let annsArray: any[] = [];
      if (!annsRaw) annsArray = [];
      else if (Array.isArray(annsRaw)) annsArray = annsRaw;
      else if (annsRaw instanceof Map) {
        annsRaw.forEach((v: any) => {
          if (Array.isArray(v)) annsArray.push(...v);
          else if (v) annsArray.push(v);
        });
      } else if (typeof annsRaw === 'object') {
        try {
          Object.values(annsRaw).forEach((v: any) => {
            if (Array.isArray(v)) annsArray.push(...v);
            else if (v) annsArray.push(v);
          });
        } catch {
          annsArray = [];
        }
      } else {
        annsArray = [];
      }

      // de-duplicate and keep only those in uidsToRemove (if provided)
      const seen = new Set<string>();
      annsArray = annsArray.filter((a: any) => {
        const uid = a?.annotationUID ?? a?.uid ?? null;
        if (!uid) return false;
        if (seen.has(uid)) return false;
        if (Array.isArray(uidsToRemove) && uidsToRemove.length > 0 && !uidsToRemove.includes(uid)) return false;
        seen.add(uid);
        return true;
      });

      // Remove each candidate
      for (const inst of annsArray) {
        try {
          const tryUid = inst.annotationUID ?? inst.uid ?? null;
          if (tryUid) {
            try {
              if (typeof stateAny.removeAnnotation === 'function') {
                const res = stateAny.removeAnnotation(tryUid);
                if (res && typeof res.then === 'function') await res;
              }
            } catch (_) {}
          }

          try {
            if (typeof stateAny.removeAnnotation === 'function') {
              const res = stateAny.removeAnnotation(inst);
              if (res && typeof res.then === 'function') await res;
            }
          } catch (_) {}

          try {
            if (el && (stateAny as any).removeAnnotation) {
              const maybe = (stateAny as any).removeAnnotation(inst, el);
              if (maybe && typeof maybe.then === 'function') await maybe;
            }
          } catch (_) {}

          try {
            const maybe = (csAnnotation.state as any).removeAnnotation?.(inst) ?? null;
            if (maybe && typeof maybe.then === 'function') await maybe;
          } catch (_) {}
        } catch (e) {
          // ignore per-instance failures
        }
      }
    } catch (e) {
      // ignore top-level
    }
  }

  // ---- restoreSavedInstances (kept, with minor robustness) ----
  async function restoreSavedInstances(instancesSaved: any[]): Promise<string[] | null> {
    if (!instancesSaved || instancesSaved.length === 0) return null;
    const mergedKeys = Object.keys(mergedSeriesMap);
    if (!mergedKeys.length) return null;

    const extractSop = (raw?: string): string | null => {
      if (!raw) return null;
      const s = String(raw).replace(/^imageId:/, '');
      const m = s.match(/\/instances\/([^\/]+)/);
      if (m && m[1]) return m[1];
      const parts = s.split('/');
      return parts.length ? parts[parts.length - 1] : s;
    };

    // Map inst -> base series (prefer non-SR)
    const instToBase = new Map<any, string | null>();
    const nonSrKeys = mergedKeys.filter((k) => !String(k).startsWith('SR_'));
    const fallbackKeys = mergedKeys;

    for (const inst of instancesSaved) {
      const raw = inst.metadata?.referencedImageId || inst.metadata?.imageId || '';
      const declaredSeries = inst.metadata?.seriesInstanceUID;
      let found: string | null = null;

      if (declaredSeries && !String(declaredSeries).startsWith('SR_') && mergedSeriesMap[declaredSeries]) {
        found = declaredSeries;
      } else {
        const sop = extractSop(raw);

        if (sop && nonSrKeys.length > 0) {
          for (const uid of nonSrKeys) {
            const files = mergedSeriesMap[uid]?.files ?? [];
            if (files.some((id) => matchesSopOnId(id, sop))) { found = uid; break; }
          }
        }

        if (!found && raw && nonSrKeys.length > 0) {
          const normRaw = normalizeId(raw);
          for (const uid of nonSrKeys) {
            const files = mergedSeriesMap[uid]?.files ?? [];
            if (files.some((id) => normalizeId(id) === normRaw)) { found = uid; break; }
          }
        }

        if (!found && nonSrKeys.length === 0) {
          if (sop) {
            for (const uid of fallbackKeys) {
              const files = mergedSeriesMap[uid]?.files ?? [];
              if (files.some((id) => matchesSopOnId(id, sop))) { found = uid; break; }
            }
          }
          if (!found && raw) {
            const normRaw = normalizeId(raw);
            for (const uid of fallbackKeys) {
              const files = mergedSeriesMap[uid]?.files ?? [];
              if (files.some((id) => normalizeId(id) === normRaw)) { found = uid; break; }
            }
          }
        }
      }

      if (!found) {
        const firstNonSr = nonSrKeys[0] ?? fallbackKeys[0];
        found = firstNonSr ?? null;
      }

      instToBase.set(inst, found);
    }

    // Group by base
    const groups = new Map<string, any[]>();
    instToBase.forEach((base, inst) => {
      const key = base ?? '__unknown__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(inst);
    });

    const createdSrIds: string[] = [];
    const loadedEntries: any[] = [];
    let firstNewSrId: string | null = null;
    let firstGroupInitialIndex = 0;
    let groupIndex = 0;

    // NEW: map để ghi nhớ files tương ứng với mỗi usedSrId
    const groupFilesMap = new Map<string, string[]>();

    for (const [baseSeriesId, instList] of Array.from(groups.entries())) {
      groupIndex += 1;
      const baseId = baseSeriesId === '__unknown__' ? mergedKeys[0] : baseSeriesId;
      if (!baseId) continue;

      const baseFiles = mergedSeriesMap[baseId]?.files ?? [];
      const baseMeta = mergedSeriesMap[baseId]?.metadata ?? ({} as Series);
      if (!baseFiles.length) continue;

      const isBaseAlreadySR = String(baseId).startsWith('SR_') && Boolean(mergedSeriesMap[baseId]);

      let usedSrId: string;
      if (isBaseAlreadySR) {
        usedSrId = baseId;
      } else {
        usedSrId = `SR_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${groupIndex}`;
        createdSrIds.push(usedSrId);

        const srDescription = `SR ${baseMeta.seriesDescription ?? ''}`;

        setExtraSeriesMap((prev) => {
          if (prev[usedSrId]) return prev;
          return {
            ...prev,
            [usedSrId]: {
              files: baseFiles,
              metadata: {
                ...baseMeta,
                seriesInstanceUID: usedSrId,
                seriesDescription: srDescription,
                seriesModality: 'SR',
              } as Series,
            },
          };
        });

        if (!firstNewSrId) firstNewSrId = usedSrId;
      }

      // store files for this SR id so we can setStack to the correct one later
      groupFilesMap.set(usedSrId, baseFiles);

      if (firstGroupInitialIndex === undefined || firstGroupInitialIndex === null) {
        firstGroupInitialIndex = 0;
      }
      if (firstGroupInitialIndex === 0) {
        const raw0 = instList[0]?.metadata?.referencedImageId || instList[0]?.metadata?.imageId || '';
        const sop0 = extractSop(raw0);
        const idx0 = sop0 ? baseFiles.findIndex((id) => matchesSopOnId(id, sop0)) : -1;
        firstGroupInitialIndex = idx0 >= 0 ? idx0 : 0;
      }

      for (const inst of instList) {
        const raw = inst.metadata?.referencedImageId || inst.metadata?.imageId || '';
        const sop = extractSop(raw);
        let resolvedIndex = sop ? baseFiles.findIndex((id) => matchesSopOnId(id, sop)) : -1;
        if (resolvedIndex < 0) resolvedIndex = 0;
        const resolvedImageId = baseFiles[resolvedIndex] ?? baseFiles[0];

        if (!inst.metadata) inst.metadata = {};
        inst.metadata.referencedImageId = resolvedImageId;
        inst.metadata.imageId = resolvedImageId;
        inst.metadata.frameIndex = typeof inst.metadata.sliceIndex === 'number' ? inst.metadata.sliceIndex : resolvedIndex;
        inst.metadata.seriesInstanceUID = usedSrId;

        const origUID = inst.annotationUID ?? `orig-${Date.now()}`;
        inst.annotationUID = makeNewAnnotationUID(origUID, usedSrId);
      }

      const entryLabel = `SR ${baseMeta.seriesDescription ?? ''}`;

      loadedEntries.push({
        id: usedSrId,
        label: entryLabel,
        count: instList.length,
        instances: instList,
      });
    }

    if (!viewportInstance || !viewportEl) return null;

    enableElement(viewportEl);
    const enabledEl = getEnabledElement(viewportEl);
    if (!enabledEl) return null;
    const vp = enabledEl.viewport as StackViewport;
    const forUID = (typeof vp.getFrameOfReferenceUID === 'function') ? vp.getFrameOfReferenceUID() : undefined;
    if (forUID) viewportEl.dataset.frameOfReferenceUID = forUID;

    // Add SR instances to state (do NOT attach handlers for SR — add without element)
    for (const entry of loadedEntries) {
      for (const inst of entry.instances) {
        try {
          try {
            const maybe = stateAny.addAnnotation?.(inst);
            if (maybe && typeof (maybe as Promise<any>).then === 'function') await maybe;
          } catch (_) {
            try { (csAnnotation.state as any).addAnnotation?.(inst); } catch (_) {}
          }
          try { stateAny.triggerAnnotationModified?.(inst, viewportEl); } catch (_) {}
          try { tryLockAnnotationByUid(inst.annotationUID); } catch (_) {}
        } catch (e) {
        }
      }
    }

    // Wait for registration
    for (const entry of loadedEntries) {
      for (const inst of entry.instances) {
        await waitForAnnotation(inst.annotationUID, 2000, 50);
      }
    }

    // Lock them again to be safe
    for (const entry of loadedEntries) {
      for (const inst of entry.instances) {
        try { tryLockAnnotationByUid(inst.annotationUID); } catch (_) {}
      }
    }

    // Build measurementsFromSR
    const measurementsFromSR: AnnotationMeasurement[] = [];
    for (const entry of loadedEntries) {
      for (const i of entry.instances) {
        const idx =
          typeof i.metadata.sliceIndex === 'number'
            ? i.metadata.sliceIndex
            : typeof i.metadata.frameIndex === 'number'
            ? i.metadata.frameIndex
            : 0;

        const liveInst = tryGetAnnotation(i.annotationUID) ?? null;

        let flatData: any = {};
        if (liveInst?.data?.cachedStats) {
          const firstStat = Object.values(liveInst.data.cachedStats)[0] ?? {};
          flatData = { ...firstStat };
        }
        flatData.handles = liveInst?.data?.handles ?? i.data?.handles ?? i.handles;

        measurementsFromSR.push({
          annotationUID: i.annotationUID,
          toolName: i.metadata?.toolName ?? i.toolName ?? '',
          label: i.metadata?.label ?? '',
          type: (i.metadata?.toolName as any) || (i.toolName as any) || 'unknown',
          data: flatData,
          metadata: {
            seriesUID: i.metadata?.seriesInstanceUID,
            studyUID,
            viewportId: deps.viewportId,
            frameIndex: idx,
            referencedImageId: i.metadata?.referencedImageId ?? '',
            createdAt: i.metadata?.createdAt || '',
          },
          createdAt: i.metadata?.createdAt || '',
        } as AnnotationMeasurement);
      }
    }

    // Merge loadedEntries into loadedSrList
    setLoadedSrList((prev) => {
      const map = new Map<string, any>();
      prev.forEach((p) => map.set(p.id, p));
      loadedEntries.forEach((e) => {
        const existing = map.get(e.id);
        if (existing) map.set(e.id, { ...existing, ...e });
        else map.set(e.id, e);
      });
      return Array.from(map.values());
    });

    // Merge measurementsFromSR into global allMeasurements
    setAllMeasurements((prev) => {
      const map = new Map<string, AnnotationMeasurement>();
      prev.forEach((m) => map.set(m.annotationUID, m));
      measurementsFromSR.forEach((m) => map.set(m.annotationUID, m));
      return Array.from(map.values());
    });

    refreshMeasurements?.();

    const reusedOrCreated = createdSrIds.length ? createdSrIds[0] : loadedEntries[0]?.id ?? null;
    setActiveSrId(reusedOrCreated);

    // --- Now set viewport stack to the SR we actually activated (if we have files for it) ---
    try {
      const targetId = reusedOrCreated;
      const targetFiles = targetId ? groupFilesMap.get(targetId) ?? groupFilesMap.get(loadedEntries[0]?.id) : groupFilesMap.get(loadedEntries[0]?.id);
      const targetInitialIndex = (measurementsFromSR.length && measurementsFromSR.find(m => String(m.metadata.seriesUID) === String(targetId))?.metadata.frameIndex) ?? 0;

      if (Array.isArray(targetFiles) && targetFiles.length > 0) {
        await viewportInstance.setStack(targetFiles, Math.min(Math.max(0, targetInitialIndex), targetFiles.length - 1));
        // small delay to ensure stack is updated
        await new Promise((r) => setTimeout(r, 50));

        // sync current frame & selection
        if (measurementsFromSR.length > 0) {
          const first =
            (firstNewSrId && measurementsFromSR.find((m) => m.metadata.seriesUID === firstNewSrId)) ||
            measurementsFromSR[0];
          Promise.resolve().then(() => {
            setSelectedMeasurementUID(first.annotationUID);
            setCurrentFrame((first.metadata.frameIndex ?? 0) + 1);
          });
        }
      }
    } catch (err) {
    }

    // render
    try {
      const re = renderingEngineRef?.current;
      if (re) {
        if (typeof re.renderViewport === 'function') re.renderViewport(deps.viewportId);
        else if (typeof re.render === 'function') re.render();
      }
    } catch (e) {}

    const resultIds = loadedEntries.map((e) => e.id).concat(createdSrIds.filter((id) => !loadedEntries.some((e) => e.id === id)));
    return resultIds.length ? resultIds : null;
  }

  const sanitizeFileName = (s?: string) => {
    if (!s) return '';
    return String(s).replace(/[\\\/:*?"<>|]/g, '-');
  };

  // ---- INTERNAL: collect context + build SR payload (NO side-effects) ----
  function collectExportContext(documentTitle?: string) {
    const uids = allMeasurements
      .filter((m) => !String(m.metadata?.seriesUID).startsWith('SR_'))
      .map((m) => m.annotationUID);

    const instancesSaved: any[] = uids
      .map((uid) => tryGetAnnotation(uid) ?? null)
      .filter(Boolean)
      .map((inst) => JSON.parse(JSON.stringify(inst)));

    const srRequest = buildStructuredReport(studyUID, uids, {
      documentTitle: documentTitle ?? undefined,
    });

    return { uids, instancesSaved, srRequest } as const;
  }

  // ---- NEW: Build-only for "View SR" (no POST, no download) ----
  function getSrJson(documentTitle?: string) {
    const { srRequest } = collectExportContext(documentTitle);
    return srRequest; // caller can show JSON (modal/console/etc.)
  }

  // ---- Export JSON ----
  async function exportSRAsJSON(documentTitle?: string): Promise<string[] | null> {
    const { uids, instancesSaved, srRequest } = collectExportContext(documentTitle);
    if (!instancesSaved.length) return null;

    // Save local copy (optional)
    try {
      const fileName = `SR_${studyUID}_${sanitizeFileName(documentTitle || 'report')}.json`;
      saveAs(new Blob([JSON.stringify(srRequest, null, 2)], { type: 'application/json' }), fileName);
    } catch (e) {
    }

    // NO server POST in static-local mode.
    // Proceed to local fallback behavior: remove originals and restore SR instances locally.

    try {
      await forceRemoveOriginalAnnotations(uids, viewportEl);
    } catch (e) {
    }

    try {
      setAllMeasurements((prev) => prev.filter((m) => !uids.includes(m.annotationUID)));
    } catch (e) {
    }

    const createdIds = await restoreSavedInstances(instancesSaved);
    return createdIds;
  }

  // ---- Export placeholder DICOM ----
  async function exportSRAsDICOMPlaceholder(documentTitle?: string): Promise<string[] | null> {
    const { uids, instancesSaved, srRequest } = collectExportContext(documentTitle);
    if (!instancesSaved.length) return null;

    // Save local dcm placeholder
    try {
      const fileName = `SR_${studyUID}_${sanitizeFileName(documentTitle || 'report')}.dcm`;
      const dcmBlob = new Blob([JSON.stringify(srRequest, null, 2)], { type: 'application/dicom' });
      saveAs(dcmBlob, fileName);
    } catch (e) {
    }

    // NO server POST in static-local mode.
    // Proceed to local fallback behavior.

    try {
      await forceRemoveOriginalAnnotations(uids, viewportEl);
    } catch (e) {
    }

    try {
      setAllMeasurements((prev) => prev.filter((m) => !uids.includes(m.annotationUID)));
    } catch (e) {}

    const createdIds = await restoreSavedInstances(instancesSaved);
    return createdIds;
  }

  // IMPORTANT: expose getSrJson so the UI "View SR" button can use it without POSTing
  return { getSrJson, exportSRAsJSON, exportSRAsDICOMPlaceholder };
}

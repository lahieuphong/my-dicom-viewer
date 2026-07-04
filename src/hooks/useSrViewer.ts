// // src/hooks/useSrViewer.ts
// 'use client';

// import {
//   addMeasurementsToState,
//   parseSrContentToMeasurements,
// } from '@/lib/annotationUtils';
// import { enableElement } from '@/lib/enableElement';
// import { WADO_RS_BASE, DEFAULT_HEADERS } from '@/lib/pacs/config';

// type ExtraSeriesMapSetter = React.Dispatch<
//   React.SetStateAction<Record<string, { files: string[]; metadata: any }>>
// >;

// function normalizeImageId(id?: unknown): string {
//   if (!id) return '';
//   let s = String(id);
//   s = s.replace(/^imageId:/, '').replace(/^wadors:/, '');
//   const q = s.indexOf('?');
//   if (q >= 0) s = s.slice(0, q);
//   while (s.endsWith('/')) s = s.slice(0, -1);
//   return s;
// }

// function matchesSopOnId(imageId: string, sop: string): boolean {
//   const nid = normalizeImageId(imageId);
//   return nid.includes(`/instances/${sop}`) || nid.endsWith(`/${sop}`) || nid.split('/').includes(sop);
// }

// function buildJsonHeaders(): Record<string, string> {
//   return {
//     ...(DEFAULT_HEADERS ?? {}),
//     Accept: 'application/json',
//   };
// }

// function getReferencedSopUID(m: any): string {
//   const rawRef = String(
//     m?.metadata?.referencedImageId ??
//     m?.metadata?.imageId ??
//     m?.metadata?.referencedSOPInstanceUID ??
//     ''
//   );
//   return rawRef.replace(/^imageId:/, '').split('/').pop() ?? '';
// }

// export default function useSrViewer(deps: {
//   studyUID: string;
//   mergedSeriesMap: Record<string, { files: string[]; metadata: any }>;
//   viewportInstance: any | null;
//   viewportEl: HTMLDivElement | null;
//   setExtraSeriesMap: ExtraSeriesMapSetter;
//   setLoadedSrList: (fn: (prev: any[]) => any[]) => void;
//   setAllMeasurements: (m: any[] | ((prev: any[]) => any[])) => void;
//   refreshMeasurements?: () => void;
//   setActiveSrId?: (id: string | null) => void;
//   setSelectedMeasurementUID?: (id: string | null) => void;
//   setCurrentFrame?: (n: number) => void;
//   renderingEngineRef?: { current: any } | undefined;
// }) {
//   const {
//     studyUID,
//     mergedSeriesMap,
//     viewportInstance,
//     viewportEl,
//     setExtraSeriesMap,
//     setLoadedSrList,
//     setAllMeasurements,
//     refreshMeasurements,
//     setActiveSrId,
//     setSelectedMeasurementUID,
//     setCurrentFrame,
//     renderingEngineRef,
//   } = deps;

//   // Use WADO_RS_BASE from config (already normalized there)
//   const wadorsBase = String(WADO_RS_BASE ?? '').replace(/\/+$/, '');

//   async function resolveSrInstanceUID(studyUID_: string, seriesUID_: string): Promise<string | null> {
//     if (!studyUID_ || !seriesUID_) return null;

//     const url = `${wadorsBase}/studies/${encodeURIComponent(studyUID_)}/series/${encodeURIComponent(seriesUID_)}/instances/sr`;
//     try {
//       const res = await fetch(url, {
//         method: 'GET',
//         headers: buildJsonHeaders(),
//         credentials: 'include',
//       });
//       if (res.ok) {
//         const j = await res.json();
//         if (Array.isArray(j) && j.length > 0) {
//           const first = j[0];
//           const candidate = String(
//             first.sopInstanceUID ??
//             first.SOPInstanceUID ??
//             first['00080018']?.Value?.[0] ??
//             Object.values(first).find((v: any) =>
//               typeof v === 'string' && v.includes('.')
//             ) ??
//             ''
//           ).trim();
//           if (candidate) return candidate;
//         }
//       }
//     } catch (e) {
//       console.debug('[useSrViewer] wadors fetch error', e);
//     }

//     // fallback to application-level structured-report list under root (if present)
//     try {
//       const root = String(WADO_RS_BASE ?? '').replace(/\/+(dicomweb|dicom-web)?\/?$/i, '').replace(/\/+$/, '');
//       const url2 = `${root}/api/structured-report`;
//       const res2 = await fetch(url2, {
//         method: 'GET',
//         headers: buildJsonHeaders(),
//         credentials: 'include',
//       });
//       if (res2.ok) {
//         const list = await res2.json();
//         const bySeries = list.find((x: any) => x.seriesInstanceUID === seriesUID_);
//         const byStudy = list.find((x: any) => x.studyInstanceUID === studyUID_);
//         const chosen = bySeries || byStudy || list[0];
//         return chosen?.sopInstanceUID ?? chosen?.srUID ?? chosen?.SOPInstanceUID ?? null;
//       }
//     } catch (e) {
//       console.debug('[useSrViewer] structured-report fetch error', e);
//     }

//     return null;
//   }

//   async function fetchSrJsonMetadata(studyUID_: string, seriesUID_: string, instanceUID_: string) {
//     const url = `${wadorsBase}/studies/${encodeURIComponent(studyUID_)}/series/${encodeURIComponent(seriesUID_)}/instances/${encodeURIComponent(instanceUID_)}/metadata/sr`;
//     try {
//       const res = await fetch(url, {
//         method: 'GET',
//         headers: buildJsonHeaders(),
//         credentials: 'include',
//       });
//       if (res.ok) {
//         const json = await res.json();
//         // many servers return array of DICOM JSON objects; convert to single object if needed
//         return Array.isArray(json) && json.length > 0 ? json[0] : json;
//       }
//     } catch (e) {
//       console.debug('[useSrViewer] fetchSrJsonMetadata error', e);
//     }

//     // fallback: application-level structured-report list (root)
//     try {
//       const root = String(WADO_RS_BASE ?? '').replace(/\/+(dicomweb|dicom-web)?\/?$/i, '').replace(/\/+$/, '');
//       const url2 = `${root}/api/structured-report`;
//       const res2 = await fetch(url2, {
//         method: 'GET',
//         headers: buildJsonHeaders(),
//         credentials: 'include',
//       });
//       if (res2.ok) {
//         const list = await res2.json();
//         const chosen = list.find((x: any) => x.sopInstanceUID === instanceUID_);
//         return chosen?.metadata ?? null;
//       }
//     } catch (e) {
//       // ignore
//     }

//     return null;
//   }

//   async function viewSr(seriesUID: string, instanceUID?: string | null) {
//     try {
//       if (!seriesUID) throw new Error('Missing seriesUID');

//       const resolvedInstanceUID = (instanceUID && String(instanceUID).trim()) || (await resolveSrInstanceUID(studyUID, seriesUID));
//       if (!resolvedInstanceUID) throw new Error('Không tìm thấy instance SR cho series này');

//       const srJson = await fetchSrJsonMetadata(studyUID, seriesUID, resolvedInstanceUID);
//       const measurements = parseSrContentToMeasurements(srJson, studyUID, seriesUID) || [];

//       setLoadedSrList((prev) => {
//         const map = new Map(prev.map((p: any) => [p.id, p]));
//         const existing = map.get(seriesUID) ?? {};
//         map.set(seriesUID, {
//           ...existing,
//           id: seriesUID,
//           label: `SR ${seriesUID}`,
//           count: measurements.length,
//           instances: Array.from(new Set([...(existing.instances ?? []), resolvedInstanceUID])),
//         });
//         return Array.from(map.values());
//       });

//       // Try to resolve base image files for this SR (so setStack can work)
//       const nonSrKeys = Object.keys(mergedSeriesMap).filter(k => !k.startsWith('SR_'));
//       let resolvedBaseFiles: string[] | null = null;

//       for (const m of measurements) {
//         const sop = getReferencedSopUID(m);
//         for (const uid of nonSrKeys) {
//           const files = mergedSeriesMap[uid]?.files ?? [];
//           if (files.some(id => matchesSopOnId(id, sop))) {
//             resolvedBaseFiles = files;
//             break;
//           }
//         }
//         if (resolvedBaseFiles) break;
//       }

//       setExtraSeriesMap((prev) => {
//         if (prev[seriesUID]) return prev;
//         return {
//           ...prev,
//           [seriesUID]: {
//             files: resolvedBaseFiles ?? [],
//             metadata: {
//               seriesInstanceUID: seriesUID,
//               seriesDescription: `SR ${seriesUID}`,
//               seriesModality: 'SR',
//             },
//           },
//         };
//       });

//       addMeasurementsToState(measurements);

//       setAllMeasurements((prev) => {
//         const map = new Map(prev.map(p => [p.annotationUID, p]));
//         measurements.forEach(m => map.set(m.annotationUID, m));
//         return Array.from(map.values());
//       });

//       if (viewportInstance && resolvedBaseFiles?.length && viewportEl) {
//         enableElement(viewportEl);
//         const idx = measurements[0]?.metadata?.frameIndex ?? 0;
//         await viewportInstance.setStack(resolvedBaseFiles, Math.min(idx, resolvedBaseFiles.length - 1));
//         await new Promise((r) => setTimeout(r, 50));
//       }

//       setActiveSrId?.(seriesUID);
//       setSelectedMeasurementUID?.(measurements[0]?.annotationUID ?? null);
//       setCurrentFrame?.((measurements[0]?.metadata?.frameIndex ?? 0) + 1);

//       refreshMeasurements?.();

//       const re = renderingEngineRef?.current;
//       if (re) {
//         if (typeof re.renderViewport === 'function') re.renderViewport(viewportEl?.id ?? '');
//         else if (typeof re.render === 'function') re.render();
//       }

//       console.log('[useSrViewer] loaded SR into viewport', seriesUID);
//     } catch (err) {
//       console.error('[useSrViewer] Failed to view SR', err);
//       throw err;
//     }
//   }

//   return { viewSr };
// }

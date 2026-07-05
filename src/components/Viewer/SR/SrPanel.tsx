// // src/components/Viewer/SR/SrPanel.tsx
// 'use client';

// import React, { useState } from 'react';
// import { WADO_RS_BASE, PACS_API_BASE, DEFAULT_HEADERS } from '@/lib/pacs/config';

// function buildJsonHeaders(): Record<string, string> {
//   const h: Record<string, string> = { Accept: 'application/json' };
//   try {
//     if (DEFAULT_HEADERS && typeof DEFAULT_HEADERS === 'object') {
//       Object.assign(h, DEFAULT_HEADERS);
//       h.Accept = 'application/json';
//     }
//   } catch {}
//   return h;
// }

// export default function SrPanel({
//   studyUID,
//   seriesUID,
//   instanceUID,
// }: {
//   studyUID: string;
//   seriesUID: string;
//   instanceUID: string;
// }) {
//   const [loading, setLoading] = useState(false);
//   const [error, setError] = useState<string | null>(null);
//   const [srJson, setSrJson] = useState<any | null>(null);

//   const resolveWadorsBaseForSr = (): string | null => {
//     const base = (WADO_RS_BASE ?? PACS_API_BASE ?? '') as string;
//     if (!base) return null;
//     let b = String(base).replace(/\/+$/g, '');
//     if (b.includes('/dicomweb')) {
//       b = b.replace('/dicomweb', '/dicom-web');
//     } else if (!b.includes('/dicom-web')) {
//       b = `${b}/dicom-web`;
//     }
//     return b;
//   };

//   const handleViewSr = async () => {
//     setLoading(true);
//     setError(null);
//     setSrJson(null);

//     try {
//       if (!seriesUID || !instanceUID) throw new Error('Thiếu SeriesUID hoặc InstanceUID');

//       const wadorsBase = resolveWadorsBaseForSr();
//       if (!wadorsBase) throw new Error('Không có WADO-RS base');

//       const url = `${wadorsBase}/studies/${encodeURIComponent(
//         studyUID
//       )}/series/${encodeURIComponent(seriesUID)}/instances/${encodeURIComponent(
//         instanceUID
//       )}/metadata/sr`;

//       const res = await fetch(url, {
//         method: 'GET',
//         headers: buildJsonHeaders(),
//         credentials: 'omit',
//       });

//       if (!res.ok) throw new Error(`Fetch thất bại: ${res.status}`);

//       const j = await res.json();
//       setSrJson(j);
//     } catch (err: any) {
//       setError(err?.message ?? 'Lỗi khi tải Structured Report JSON');
//     } finally {
//       setLoading(false);
//     }
//   };

//   return (
//     <div className="p-4 text-white h-full flex flex-col">
//       <h2 className="text-lg font-bold mb-4">Structured Report (Raw JSON)</h2>

//       <button
//         onClick={handleViewSr}
//         disabled={loading}
//         className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded disabled:opacity-50"
//       >
//         {loading ? 'Loading...' : 'View SR'}
//       </button>

//       {error && <div className="mt-4 text-red-500">Error: {error}</div>}

//       {srJson && (
//         <div className="mt-4 flex-1 overflow-auto bg-black text-green-400 p-2 rounded">
//           <pre className="text-xs whitespace-pre-wrap">
//             {JSON.stringify(srJson, null, 2)}
//           </pre>
//         </div>
//       )}
//     </div>
//   );
// }

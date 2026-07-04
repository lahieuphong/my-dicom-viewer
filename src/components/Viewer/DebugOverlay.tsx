// src/components/Viewer/DebugOverlay.tsx
'use client';

export default function DebugOverlay({
  renderingReady,
  cornerstoneImageLoader,
  viewportEl,
  viewportInstance,
  enabled,
  enabledHasImage,
  imageCount,
}: {
  renderingReady: boolean;
  cornerstoneImageLoader?: any;
  viewportEl?: HTMLElement | null;
  viewportInstance?: any;
  enabled?: any;
  enabledHasImage?: boolean;
  imageCount?: number;
}) {
  return (
    <div style={{
      position: 'fixed', right: 12, bottom: 12, zIndex: 9999,
      background: 'rgba(0,0,0,0.6)', color: '#fff', padding: 8, borderRadius: 8, fontSize: 12, maxWidth: 360
    }}>
      <div><b>CornerstoneReady:</b> {String(renderingReady)}</div>
      <div><b>ImageLoader:</b> {cornerstoneImageLoader ? 'ok' : 'null'}</div>
      <div><b>viewportEl:</b> {viewportEl ? `${viewportEl.tagName} ${viewportEl.offsetWidth}x${viewportEl.offsetHeight}` : 'null'}</div>
      <div><b>viewportInstance:</b> {viewportInstance ? 'exists' : 'null'}</div>
      <div><b>enabled exists:</b> {enabled ? 'yes' : 'no'}</div>
      <div><b>enabledHasImage:</b> {typeof enabledHasImage === 'boolean' ? String(enabledHasImage) : 'unknown'}</div>
      <div><b>imageCount:</b> {imageCount ?? 0}</div>
    </div>
  );
}

// src/lib/viewer/canvasUtils.ts
'use client';

export function normalizeCanvasAndContext(containerEl?: HTMLElement | null) {
  try {
    if (!containerEl) return;
    // find a canvas inside container (cornerstone uses canvas.cornerstone-canvas)
    const canvas =
      (containerEl.querySelector?.('canvas.cornerstone-canvas') ??
        containerEl.querySelector?.('canvas')) as HTMLCanvasElement | null;
    if (!canvas) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cssW = Math.max(0, Math.round(canvas.clientWidth || canvas.offsetWidth || 0));
    const cssH = Math.max(0, Math.round(canvas.clientHeight || canvas.offsetHeight || 0));
    if (cssW === 0 || cssH === 0) return;

    const wantW = Math.max(1, Math.round(cssW * dpr));
    const wantH = Math.max(1, Math.round(cssH * dpr));

    if (canvas.width !== wantW || canvas.height !== wantH) {
      try {
        canvas.width = wantW;
        canvas.height = wantH;
      } catch (e) {
        // ignore failures
      }
    }

    // ensure style width/height matches CSS
    try {
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    } catch {}

    return { canvas, dpr, cssW, cssH, bufferWidth: canvas.width, bufferHeight: canvas.height };
  } catch (e) {
    return null;
  }
}

// src/lib/viewer/canvasUtils.ts  (thêm file hoặc bổ sung vào file normalizeCanvasAndContext hiện tại)
export function ensureCanvasSizing(container: HTMLElement | null) {
  if (!container || typeof window === 'undefined') return;
  const dpr = window.devicePixelRatio || 1;
  try {
    const canvases = Array.from(container.querySelectorAll('canvas')) as HTMLCanvasElement[];
    canvases.forEach((c) => {
      const rect = c.getBoundingClientRect();
      // ensure we use integer css pixels
      const cssW = Math.max(1, Math.round(rect.width));
      const cssH = Math.max(1, Math.round(rect.height));
      const bufW = Math.max(1, Math.round(cssW * dpr));
      const bufH = Math.max(1, Math.round(cssH * dpr));
      // If backing buffer differs, update it
      if (c.width !== bufW || c.height !== bufH) {
        c.width = bufW;
        c.height = bufH;
        c.style.width = `${cssW}px`;
        c.style.height = `${cssH}px`;
        try {
          const ctx = c.getContext('2d');
          if (ctx && typeof ctx.setTransform === 'function') {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
        } catch {}
      }
      // remove transforms that could cause rendering mismatch
      try { c.style.transform = 'none'; } catch {}
      try { c.style.imageRendering = 'auto'; } catch {}
    });
  } catch (e) {
    // swallow
  }
}


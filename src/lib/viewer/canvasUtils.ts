// src/lib/viewer/canvasUtils.ts
'use client';

export function normalizeCanvasAndContext(containerEl?: HTMLElement | null) {
  try {
    if (!containerEl) return;
    const canvas =
      (containerEl.querySelector?.('canvas.cornerstone-canvas') ??
        containerEl.querySelector?.('canvas')) as HTMLCanvasElement | null;
    if (!canvas) return;

    // Cornerstone creates the canvas at 100% of the enabled element. Keep that
    // responsive contract intact; fixed pixel styles make panel resizing crop
    // the old canvas instead of resizing it.
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.objectFit = 'contain';
    canvas.style.objectPosition = 'center';

    const rect = containerEl.getBoundingClientRect();
    const cssW = Math.max(0, Math.round(containerEl.clientWidth || rect.width || 0));
    const cssH = Math.max(0, Math.round(containerEl.clientHeight || rect.height || 0));
    if (cssW === 0 || cssH === 0) return;

    // Do not assign canvas.width/height here. Changing either property clears
    // the current frame; RenderingEngine.resize owns the backing-buffer update
    // and redraws it atomically.
    return { canvas, cssW, cssH, bufferWidth: canvas.width, bufferHeight: canvas.height };
  } catch {
    return null;
  }
}

export function ensureCanvasSizing(container: HTMLElement | null) {
  normalizeCanvasAndContext(container);
}

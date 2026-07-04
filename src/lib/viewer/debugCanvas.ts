// src/lib/viewer/debugCanvas.ts
'use client';

let ENABLE_CANVAS_DEBUG = false; // 👈 đổi false để tắt toàn bộ log

export function setCanvasDebug(enabled: boolean) {
  ENABLE_CANVAS_DEBUG = enabled;
}

export function logCanvasState(
  tag: string,
  rootEl?: HTMLElement | null
) {
  if (!ENABLE_CANVAS_DEBUG) return;

  try {
    if (!rootEl) {
      console.log(`[CanvasDebug][${tag}] rootEl = null`);
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    const canvases = Array.from(rootEl.querySelectorAll('canvas')) as HTMLCanvasElement[];

    if (canvases.length === 0) {
      console.log(`[CanvasDebug][${tag}] no canvas found`);
      return;
    }

    canvases.forEach((c, i) => {
      const cssW = c.clientWidth;
      const cssH = c.clientHeight;
      const bufW = c.width;
      const bufH = c.height;

      const expectedW = Math.round(cssW * dpr);
      const expectedH = Math.round(cssH * dpr);

      const transform = c.style?.transform || 'none';

      console.log(
        `[CanvasDebug][${tag}][${i}]`,
        {
          dpr,
          cssSize: `${cssW}x${cssH}`,
          bufferSize: `${bufW}x${bufH}`,
          expectedBuffer: `${expectedW}x${expectedH}`,
          bufferMismatch:
            bufW !== expectedW || bufH !== expectedH,
          cssTransform: transform,
        }
      );
    });
  } catch (e) {
    console.warn('[CanvasDebug] log failed', e);
  }
}

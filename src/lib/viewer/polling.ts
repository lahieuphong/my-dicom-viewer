// src/lib/viewer/polling.ts
'use client';
// Polling / wait / render-nudge helpers for Viewer.

import type { RefObject } from 'react';
import { getEnabledElementSafeLocal, safeInspect } from './dom';
import { VIEWPORT_ID } from '@/constants/viewport';

/**
 * Wait until element has non-zero visible size. Uses ResizeObserver when available and falls back to polling.
 */
export async function waitForElementVisible(el: HTMLElement | null, timeout = 3000): Promise<boolean> {
  if (!el) return false;
  try {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
  } catch {}

  if (typeof ResizeObserver === 'undefined') {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 80));
      try {
        const r2 = el.getBoundingClientRect();
        if (r2.width > 0 && r2.height > 0) return true;
      } catch {}
    }
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    let ro: ResizeObserver | null = null;
    let done = false;
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      try { ro?.disconnect(); } catch {}
      resolve(false);
    }, timeout);

    try {
      ro = new ResizeObserver(() => {
        try {
          const rc = el.getBoundingClientRect();
          if (rc.width > 0 && rc.height > 0) {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { ro?.disconnect(); } catch {}
            resolve(true);
          }
        } catch {}
      });
      ro.observe(el);
    } catch (err) {
      clearTimeout(timer);
      try { ro?.disconnect(); } catch {}
      resolve(false);
    }
  });
}

/**
 * Poll for a global flag window.__cornerstoneReady (used as a signal that cornerstone init finished).
 */
export async function waitForCornerstoneReady(timeoutMs = 3500): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  return new Promise((resolve) => {
    try {
      if ((window as any).__cornerstoneReady) return resolve(true);
      const start = Date.now();
      const id = window.setInterval(() => {
        if ((window as any).__cornerstoneReady) {
          clearInterval(id);
          return resolve(true);
        }
        if (Date.now() - start > timeoutMs) {
          clearInterval(id);
          return resolve(false);
        }
      }, 80);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Wait for rendering engine + viewportInstance + enabled element to exist.
 */
export async function waitForEngineAndViewport(
  renderingEngineRef: RefObject<any> | null,
  viewportInstance: any,
  viewportEl: HTMLElement | null,
  timeout = 3000,
  interval = 100
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (renderingEngineRef?.current && viewportInstance && viewportEl) {
        // use safe getter and avoid expanding huge objects
        const enabled = getEnabledElementSafeLocal(viewportEl);
        if (enabled) return true;
      }
    } catch {}
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

/**
 * Log a compact safe summary about enabled element / canvas / viewportInstance.
 * evaluate a circular/huge object which sometimes triggers RangeError while expanding.
 */
export function logEnabledDebug(el: HTMLElement | null, vpInstance: any, renderingEngineRef?: RefObject<any>) {
  try {
    const safe: Record<string, any> = { enabledExists: false };

    try {
      const en = getEnabledElementSafeLocal(el);
      safe.enabledExists = !!en;

      if (en) {
        try { safe.imageExists = !!en.image; } catch { safe.imageExists = 'error'; }
        try { safe.imageId = typeof en.image?.imageId === 'string' ? en.image.imageId : String(en.image?.imageId ?? 'n/a'); } catch { safe.imageId = 'error'; }
        try { safe.columns = typeof en.image?.columns === 'number' ? en.image.columns : null; } catch { safe.columns = 'error'; }
        try { safe.rows = typeof en.image?.rows === 'number' ? en.image.rows : null; } catch { safe.rows = 'error'; }
      }
    } catch (e: any) {
      safe._getEnabledErr = (e && e.message) ? e.message : String(e);
    }

    try {
      const canvas = (el?.querySelector?.('canvas.cornerstone-canvas') ?? el?.querySelector?.('canvas')) as HTMLCanvasElement | null;
      if (canvas) {
        safe.canvas = { clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight, bufferWidth: canvas.width, bufferHeight: canvas.height, dpr: typeof window !== 'undefined' ? window.devicePixelRatio : null };
      } else {
        safe.canvas = null;
      }
    } catch (e) {
      safe.canvas = { error: String(e) };
    }

    try {
      if (vpInstance) {
        safe.vpInstance = { hasRender: typeof vpInstance?.render === 'function', hasSetStack: typeof vpInstance?.setStack === 'function' };
        try { safe.vpInstance.getImageIdsLen = Array.isArray(vpInstance.getImageIds?.()) ? vpInstance.getImageIds().length : null; } catch {}
      } else {
        safe.vpInstance = null;
      }
    } catch (e) {
      safe.vpInstance = { error: String(e) };
    }

    // Use debug so devtools won't attempt deep expansion unless user explicitly expands
  } catch (outer) {
  }
}

/**
 * Small helper: force a lightweight repaint of an element to work around cases where
 * the canvas doesn't repaints until a user-driven composite/reflow (scroll, resize).
 */
function forceRepaint(el: HTMLElement | null) {
  if (!el) return;
  try {
    // use will-change + translateZ trick, then flush layout
    const oldWill = el.style.willChange;
    el.style.willChange = 'transform';
    el.style.transform = 'translateZ(0)';
    // force layout
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    void el.offsetHeight;
    el.style.transform = '';
    // restore
    el.style.willChange = oldWill ?? '';
  } catch (e) {
    try { el.style.willChange = ''; } catch {}
  }
}

/**
 * Try to nudge viewport render: reset / render / resize. Best-effort and defensive.
 */
export async function forceRenderCheck(el: HTMLElement | null, vpInstance: any, renderingEngineRef?: RefObject<any>) {
  try {
    // Do lightweight debug only (avoid expanding big objects)
    logEnabledDebug(el, vpInstance, renderingEngineRef);

    if (vpInstance) {
      try { if (typeof vpInstance.reset === 'function') vpInstance.reset(); } catch {}
      try { const maybe = vpInstance.render?.(); if (maybe && typeof maybe.then === 'function') await maybe; } catch {}
    }

    try { renderingEngineRef?.current?.resize?.(); } catch {}
    try { // ensure explicit viewport id when calling renderViewport
      if (typeof renderingEngineRef?.current?.renderViewport === 'function') {
        try { renderingEngineRef?.current?.renderViewport?.(VIEWPORT_ID); } catch {}
      }
    } catch {}

    // small pause to allow browser to flush
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 80));

    // Best‑effort force a repaint on the element before final debug snapshot
    try { forceRepaint(el); } catch {}

    logEnabledDebug(el, vpInstance, renderingEngineRef);
  } catch (e) {
  }
}
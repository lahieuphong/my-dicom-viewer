// src/lib/viewer/polling.ts
'use client';
// Polling / wait / render-nudge helpers for Viewer.

import type { RefObject } from 'react';
import { VIEWPORT_ID } from '@/constants/viewport';

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
    await new Promise((r) => setTimeout(r, 80));

    // Best-effort force a repaint on the element.
    try { forceRepaint(el); } catch {}
  } catch (e) {
  }
}

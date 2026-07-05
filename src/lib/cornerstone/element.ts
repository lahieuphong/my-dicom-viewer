// src/lib/cornerstone/element.ts
'use client';
export function enableElement(element?: HTMLElement | null) {
  if (!element) return;
  try {
    element.dataset.viewportEnabled = 'true';
  } catch {}
}

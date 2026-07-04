// src/lib/renderer.ts
'use client';

import { RenderingEngine } from '@cornerstonejs/core';

export const RENDERER_ID = 'main-renderer';

let _engine: RenderingEngine | null = null;

/**
 * Trả về singleton RenderingEngine (KHÔNG wrap, KHÔNG hack).
 */
export function getRenderingEngine(id = RENDERER_ID): RenderingEngine {
  if (!_engine) {
    _engine = new RenderingEngine(id);
  }
  return _engine;
}
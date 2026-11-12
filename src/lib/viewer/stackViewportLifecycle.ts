// Enabling and disabling one stack viewport of the shared rendering engine.
'use client';

import {
  Enums as CoreEnums,
  type RenderingEngine,
  type StackViewport,
} from '@cornerstonejs/core';
import { ToolGroupManager } from '@cornerstonejs/tools';

import { TOOL_GROUP } from '@/constants/toolgroup';
import { enableElement } from '@/lib/cornerstone/element';
import { normalizeCanvasAndContext } from '@/lib/viewer/canvasUtils';

const VIEWPORT_BACKGROUND: [number, number, number] = [0, 0, 0];

function getViewport(engine: RenderingEngine, viewportId: string) {
  try {
    return engine.getViewport(viewportId) ?? null;
  } catch {
    return null;
  }
}

function removeFromToolGroup(engine: RenderingEngine, viewportId: string) {
  try {
    ToolGroupManager.getToolGroup(TOOL_GROUP)?.removeViewports(
      engine.id,
      viewportId
    );
  } catch {}
}

/**
 * Enables `viewportId` as a stack viewport on `element` and adds it to the
 * viewer's tool group. A viewport with that ID on another element is disabled
 * first; one already on `element` is reused. Every pane of the grid shares the
 * engine and the tool group, which is what lets tools and Image Slice Sync work
 * across panes, so this only ever touches the requested viewport.
 */
export function mountStackViewport(
  engine: RenderingEngine,
  viewportId: string,
  element: HTMLDivElement
): StackViewport {
  const existing = getViewport(engine, viewportId);
  if (existing && existing.element !== element) {
    unmountStackViewport(engine, viewportId);
  }

  if (getViewport(engine, viewportId)?.element !== element) {
    engine.enableElement({
      viewportId,
      type: CoreEnums.ViewportType.STACK,
      element,
      defaultOptions: { background: VIEWPORT_BACKGROUND },
    });
  }
  const viewport = engine.getStackViewport(viewportId) as StackViewport;

  enableElement(element);
  // Panel drags keep the backing buffer until they settle; the canvas must
  // scale uniformly (object-fit: contain) meanwhile instead of stretching.
  normalizeCanvasAndContext(element);
  try {
    element.dataset.viewportRole = 'content';
    element.dataset.viewportUid = viewportId;
  } catch {}

  const toolGroup = ToolGroupManager.getToolGroup(TOOL_GROUP);
  if (toolGroup && !(toolGroup.getViewportIds?.() ?? []).includes(viewportId)) {
    toolGroup.addViewport(viewportId, engine.id);
  }

  return viewport;
}

/**
 * Removes `viewportId` from the tool group and disables it. With `element`,
 * nothing happens unless the viewport is still on that element, so a pane that
 * unmounts late cannot disable a viewport another pane has enabled since.
 * `setViewports([])` would reset the whole engine, sibling panes included.
 */
export function unmountStackViewport(
  engine: RenderingEngine,
  viewportId: string,
  element?: HTMLElement
) {
  const viewport = getViewport(engine, viewportId);
  if (element && viewport && viewport.element !== element) return;

  removeFromToolGroup(engine, viewportId);
  if (!viewport) return;
  try {
    engine.disableElement(viewportId);
  } catch {}
}

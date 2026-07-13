// src/hooks/useToolManager.ts
'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  WindowLevelTool,
  PanTool,
  ZoomTool,
  LengthTool,
  BidirectionalTool,
  ArrowAnnotateTool,
  EllipticalROITool,
  RectangleROITool,
  CircleROITool,
  SplineROITool,
  StackScrollTool,
  AngleTool,
  ToolGroupManager,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';

import { initCornerstone } from '@/lib/cornerstone';
import { TOOL_GROUP } from '@/constants/toolgroup';
import {
  registerToolsOnce,
  STACK_SCROLL_CONFIGURATION,
} from '@/lib/cornerstone/tools';

export type ToolID =
  | 'adjust'
  | 'pan'
  | 'zoom'
  | 'length'
  | 'bidirectional'
  | 'arrowAnnotate'
  | 'ellipticalROI'
  | 'rectangleROI'
  | 'circleROI'
  | 'splineROI'
  | 'angle'
  | 'cine'
  | 'rotate90'
  | 'flipHorizontal'
  | 'reset';

/**
 * Map between our UI tool ids and actual Cornerstone tool names.
 */
export const toolNameMap: Record<ToolID, string> = {
  adjust: WindowLevelTool.toolName,
  pan: PanTool.toolName,
  zoom: ZoomTool.toolName,
  length: LengthTool.toolName,
  bidirectional: BidirectionalTool.toolName,
  arrowAnnotate: ArrowAnnotateTool.toolName,
  ellipticalROI: EllipticalROITool.toolName,
  rectangleROI: RectangleROITool.toolName,
  circleROI: CircleROITool.toolName,
  splineROI: SplineROITool.toolName,
  angle: AngleTool.toolName,
  cine: StackScrollTool.toolName,
  // UI-only actions
  rotate90: 'rotate90',
  flipHorizontal: 'flipHorizontal',
  reset: 'reset',
};

export const measurementToolIDs: ToolID[] = [
  'length',
  'bidirectional',
  'arrowAnnotate',
  'ellipticalROI',
  'rectangleROI',
  'circleROI',
  'splineROI',
  'angle',
];

const CORNERSTONE_TOOL_NAMES = [
  WindowLevelTool.toolName,
  PanTool.toolName,
  ZoomTool.toolName,
  LengthTool.toolName,
  BidirectionalTool.toolName,
  ArrowAnnotateTool.toolName,
  EllipticalROITool.toolName,
  RectangleROITool.toolName,
  CircleROITool.toolName,
  SplineROITool.toolName,
  AngleTool.toolName,
  StackScrollTool.toolName,
];

/**
 * Only used when we need to pass a class to some ToolGroup implementations.
 * NOTE: registerToolsOnce() should already register/add classes into ToolGroup.
 */
const TOOL_CLASS_MAP: Partial<Record<ToolID, any>> = {
  adjust: WindowLevelTool,
  pan: PanTool,
  zoom: ZoomTool,
  length: LengthTool,
  bidirectional: BidirectionalTool,
  arrowAnnotate: ArrowAnnotateTool,
  ellipticalROI: EllipticalROITool,
  rectangleROI: RectangleROITool,
  circleROI: CircleROITool,
  splineROI: SplineROITool,
  angle: AngleTool,
  cine: StackScrollTool,
};

/* ================= Robust ToolGroup helpers ================= */

/**
 * Best-effort detection whether a ToolGroup contains a tool
 * (supports multiple shapes returned by various library versions).
 */
function toolGroupHasTool(tg: any, toolName: string) {
  if (!tg || !toolName) return false;
  try {
    if (typeof tg.getToolNames === 'function') {
      const names = tg.getToolNames();
      if (Array.isArray(names)) return names.includes(toolName);
    }
  } catch {}

  try {
    if (typeof tg.getTools === 'function') {
      const g: any = tg.getTools();
      if (Array.isArray(g)) {
        return g.some((t: any) => t === toolName || t?.toolName === toolName || t?.name === toolName);
      }
      if (g instanceof Map) {
        if (g.has(toolName)) return true;
        return Array.from(g.values()).some((v: any) => v && (v.toolName === toolName || v.name === toolName));
      }
      if (g && typeof g === 'object') {
        if (Object.keys(g).includes(toolName)) return true;
        return Object.values(g).some((v: any) => v && (v.toolName === toolName || v.name === toolName));
      }
    }
  } catch {}

  try {
    const internal = (tg as any).tools;
    if (internal) {
      if (internal instanceof Map) {
        if (internal.has(toolName)) return true;
        return Array.from(internal.values()).some((v: any) => v && (v.toolName === toolName || v?.name === toolName));
      }
      if (Array.isArray(internal)) {
        return internal.includes(toolName) || internal.some((t: any) => t?.toolName === toolName || t?.name === toolName);
      }
      if (typeof internal === 'object') {
        if (Object.keys(internal).includes(toolName)) return true;
        return Object.values(internal).some((v: any) => v && (v.toolName === toolName || v.name === toolName));
      }
    }
  } catch {}

  // fallback older API
  try {
    if (typeof tg.hasTool === 'function') {
      return Boolean(tg.hasTool(toolName));
    }
  } catch {}

  return false;
}

/**
 * Best-effort add tool to ToolGroup.
 * IMPORTANT: We avoid re-registering classes globally here to prevent duplicate-registration warnings.
 * Prefer that registerToolsOnce() executed earlier to perform global registration.
 */
function tryAddToolToGroup(tg: any, toolName: string, toolClass?: any) {
  if (!tg || !toolName) return false;
  try {
    if (toolGroupHasTool(tg, toolName)) return true;
  } catch {}

  // Prefer adding by name if API supports it
  try {
    if (typeof tg.addTool === 'function') {
      try { tg.addTool(toolName); } catch {}
    }
  } catch {}

  // Some ToolGroup implementations expect a class registration API
  try {
    if (!toolGroupHasTool(tg, toolName) && toolClass && typeof tg.registerTool === 'function') {
      try { tg.registerTool(toolClass); } catch {}
    }
  } catch {}

  // Final check
  try {
    return toolGroupHasTool(tg, toolName);
  } catch {
    return false;
  }
}

/**
 * Try to activate a tool using multiple method shapes used across versions.
 * Returns true if an attempt succeeded (or at least did not throw).
 */
function trySetToolActive(tg: any, toolName: string, bindings: any[] | undefined) {
  if (!tg || !toolName) return false;
  try {
    // configure first if available
    if (typeof tg.setToolConfiguration === 'function' && bindings !== undefined) {
      try { tg.setToolConfiguration(toolName, { bindings }); } catch {}
    }
  } catch {}

  // Candidate activators in priority order
  const activators = [
    (name: string) => typeof tg.setToolActive === 'function' ? tg.setToolActive(name, { bindings }) : undefined,
    (name: string) => typeof tg.setActiveTool === 'function' ? tg.setActiveTool(name, { bindings }) : undefined,
    (name: string) => typeof tg.activateTool === 'function' ? tg.activateTool(name, { bindings }) : undefined,
    // fallbacks without options
    (name: string) => typeof tg.setToolActive === 'function' ? tg.setToolActive(name) : undefined,
    (name: string) => typeof tg.setActiveTool === 'function' ? tg.setActiveTool(name) : undefined,
    (name: string) => typeof tg.activateTool === 'function' ? tg.activateTool(name) : undefined,
  ];

  for (const fn of activators) {
    try {
      const res = fn(toolName);
      // If it returned boolean true -> success
      if (res === true) return true;
      // If returned false -> try next
      if (res === false) continue;
      // If returned undefined or void, assume success (some versions return void)
      // To be conservative we consider it success if no exception thrown.
      if (res === undefined) return true;
      // If it returned a Promise, assume success (do not await here)
      if (res && typeof (res as any).then === 'function') {
        // Fire-and-forget; treat as success for UI
        try { (res as Promise<any>).catch(() => {}); } catch {}
        return true;
      }
    } catch {
      // ignore and try next
    }
  }
  return false;
}

function trySetToolPassive(tg: any, toolName: string) {
  if (!tg || !toolName) return false;
  try {
    if (typeof tg.setToolPassive === 'function') {
      try { tg.setToolPassive(toolName); return true; } catch {}
    }
  } catch {}
  try {
    if (typeof tg.setPassive === 'function') {
      try { tg.setPassive(toolName); return true; } catch {}
    }
  } catch {}
  return false;
}

function forceDeactivateAllTools(tg: any) {
  if (!tg) return;
  for (const name of CORNERSTONE_TOOL_NAMES) {
    if (name === StackScrollTool.toolName) continue;
    try {
      if (toolGroupHasTool(tg, name)) {
        trySetToolPassive(tg, name);
      }
    } catch {}
    try {
      if (typeof tg.setToolConfiguration === 'function') {
        try { tg.setToolConfiguration(name, { bindings: [] }); } catch {}
      }
    } catch {}
  }
}

/* ================= Hook implementation ================= */

export function useToolManager() {
  const [isToolReady, setIsToolReady] = useState(false);
  const addedToolNames = useRef<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      // Initialize cornerstone (core + tools + loader) — registerToolsOnce() will ensure tools added once
      const res = await initCornerstone();
      if (!res) return;
      try {
        // registerToolsOnce is idempotent and will add classes & ToolGroup config once
        registerToolsOnce();
      } catch {}
      setIsToolReady(true);
    })();
  }, []);

  const activateTool = useCallback((tool: ToolID, opts?: { isSeriesSR?: boolean }) => {
    // UI-only shortcuts
    if (tool === 'rotate90' || tool === 'flipHorizontal' || tool === 'reset') {
      return true;
    }

    // Make sure tools were registered (best-effort)
    try { registerToolsOnce(); } catch {}

    const globalIsSR = typeof window !== 'undefined' && Boolean((window as any).__CURRENT_SERIES_IS_SR);
    const isSeriesSR = opts?.isSeriesSR ?? globalIsSR ?? false;

    const tg = ToolGroupManager.getToolGroup(TOOL_GROUP);

    if (!tg) {
      return false;
    }

    if (isSeriesSR && measurementToolIDs.includes(tool)) {
      const name = toolNameMap[tool];
      try {
        if (toolGroupHasTool(tg, name)) {
          trySetToolPassive(tg, name);
          try { tg.setToolConfiguration?.(name, { bindings: [] }); } catch {}
        }
      } catch {}
      return false;
    }

    const toolName = toolNameMap[tool];
    if (!toolName) {
      return false;
    }

    // Basic validation: only attempt activation for known cornerstone tools
    if (!CORNERSTONE_TOOL_NAMES.includes(toolName)) {
      return false;
    }

    if (toolName === StackScrollTool.toolName) {
      tryAddToolToGroup(tg, toolName, StackScrollTool);
      try {
        tg.setToolConfiguration?.(toolName, {
          ...STACK_SCROLL_CONFIGURATION,
        });
      } catch {}
      return trySetToolActive(tg, toolName, [{ mouseButton: ToolEnums.MouseBindings.Wheel }]);
    }

    // Ensure the tool exists in the ToolGroup (do NOT re-register globally here)
    const toolClass = TOOL_CLASS_MAP[tool];
    try {
      if (!toolGroupHasTool(tg, toolName)) {
        const added = tryAddToolToGroup(tg, toolName, toolClass);
        if (added) {
          addedToolNames.current.add(toolName);
        }
      }
    } catch {}

    // Deactivate others to avoid input conflicts
    try {
      forceDeactivateAllTools(tg);
    } catch {}

    // Composite adjust (WindowLevel + Pan + Zoom)
    if (tool === 'adjust') {
      try {
        const wl = WindowLevelTool.toolName;
        const pan = PanTool.toolName;
        const zoom = ZoomTool.toolName;

        tryAddToolToGroup(tg, wl, WindowLevelTool);
        tryAddToolToGroup(tg, pan, PanTool);
        tryAddToolToGroup(tg, zoom, ZoomTool);

        try { tg.setToolConfiguration?.(wl, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }] }); } catch {}
        try { tg.setToolConfiguration?.(pan, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }] }); } catch {}
        try { tg.setToolConfiguration?.(zoom, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Secondary }] }); } catch {}

        const ok1 = trySetToolActive(tg, wl, [{ mouseButton: ToolEnums.MouseBindings.Primary }]);
        const ok2 = trySetToolActive(tg, pan, [{ mouseButton: ToolEnums.MouseBindings.Auxiliary }]);
        const ok3 = trySetToolActive(tg, zoom, [{ mouseButton: ToolEnums.MouseBindings.Secondary }]);

        const result = ok1 || ok2 || ok3;
        return result;
      } catch {
        return false;
      }
    }

    // Single tool activation (primary binding)
    try {
      try { tg.setToolConfiguration?.(toolName, { bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }] }); } catch {}
      const activated = trySetToolActive(tg, toolName, [{ mouseButton: ToolEnums.MouseBindings.Primary }]);
      if (activated) return true;

      // Fallback without binding options
      const fallback = trySetToolActive(tg, toolName, undefined);
      if (fallback) return true;

      return false;
    } catch {
      return false;
    }
  }, []);

  return {
    activateTool,
    isToolReady,
  };
}

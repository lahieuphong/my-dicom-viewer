// src/lib/cornerstone/tools.ts
'use client';

import * as csTools from '@cornerstonejs/tools';
import {
  ToolGroupManager,
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
  AngleTool,
  StackScrollTool,
} from '@cornerstonejs/tools';

import { ensureStackScrollWheelActive } from './stackScroll';

const TOOL_GROUP_ID = 'toolGroup';

let _registered = false;

function isToolRegisteredGlobally(ToolClass: any): boolean {
  try {
    const hasTool = (csTools as any)?.store?.hasTool;
    if (typeof hasTool === 'function') {
      return Boolean(hasTool(ToolClass));
    }

    const toolName = ToolClass?.toolName;
    return Boolean(toolName && (csTools as any)?.state?.tools?.[toolName]);
  } catch {
    return false;
  }
}

function toolGroupHasTool(toolGroup: any, toolName: string): boolean {
  if (!toolGroup || !toolName) return false;

  try {
    if (typeof toolGroup.hasTool === 'function') {
      return Boolean(toolGroup.hasTool(toolName));
    }
  } catch {}

  try {
    if (typeof toolGroup.getToolInstance === 'function') {
      return Boolean(toolGroup.getToolInstance(toolName));
    }
  } catch {}

  try {
    const instances = toolGroup.getToolInstances?.() ?? toolGroup._toolInstances;
    return Boolean(instances?.[toolName]);
  } catch {
    return false;
  }
}

/**
 * Đăng ký các tools & tạo toolGroup nếu cần. Idempotent: gọi nhiều lần chỉ thực hiện 1 lần.
 * Gọi sau khi initCornerstone() (sau khi initTools()).
 *
 * Lưu ý: giờ đây chúng ta thêm các tool vào ToolGroup một lần tại đây (an toàn vì _registered guard),
 * để đảm bảo ToolGroup luôn chứa tool trước khi setToolActive được gọi.
 */
export function registerToolsOnce(): void {
  if (_registered) return;

  try {
    // 1) register tool classes globally (if csTools exposes addTool)
    const addToolGlobal = (csTools as any)?.addTool;
    const tools = [
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
      AngleTool,
      StackScrollTool,
    ];

    if (typeof addToolGlobal === 'function') {
      for (const ToolClass of tools) {
        try {
          if (!isToolRegisteredGlobally(ToolClass)) {
            addToolGlobal(ToolClass);
          }
        } catch (e) {
          // ignore duplicate/add errors
        }
      }
    }

    // 2) ensure tool group exists
    let tg = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
    if (!tg) {
      try {
        tg = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);
      } catch (e) {
        // ignore create errors (maybe already exists)
        tg = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
      }
    }

    // 3) Add all known tool names into the tool group (idempotent, guarded by try/catch).
    // This ensures setToolActive works reliably later.
    try {
      const tgLocal = ToolGroupManager.getToolGroup(TOOL_GROUP_ID);
      if (tgLocal) {
        for (const ToolClass of tools) {
          const name = ToolClass?.toolName ?? (ToolClass?.name ?? null);
          if (!name) continue;
          try {
            // addTool may not exist on some TG versions; guard it
            if (
              !toolGroupHasTool(tgLocal, name) &&
              typeof (tgLocal as any).addTool === 'function'
            ) {
              (tgLocal as any).addTool(name);
            }
          } catch (e) {
            // ignore duplicate/add errors
          }
        }

        // Keep native Cornerstone wheel navigation active independently from
        // whichever primary tool the user selects.
        ensureStackScrollWheelActive(TOOL_GROUP_ID);
      }
    } catch (e) {
      // swallow additions errors
    }
  } catch (e) {
    // swallow top-level errors to keep best-effort (don't break app)
  } finally {
    _registered = true;
  }
}

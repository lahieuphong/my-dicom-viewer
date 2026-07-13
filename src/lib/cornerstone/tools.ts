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
  Enums as ToolEnums,
} from '@cornerstonejs/tools';

const TOOL_GROUP_ID = 'toolGroup';

let _registered = false;

export const STACK_SCROLL_CONFIGURATION = {
  invert: false,
  debounceIfNotLoaded: true,
  loop: true,
};

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
          addToolGlobal(ToolClass);
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
            if (typeof (tgLocal as any).addTool === 'function') {
              (tgLocal as any).addTool(name);
            }
          } catch (e) {
            // ignore duplicate/add errors
          }
        }

        // Configure StackScroll once (still safe to do here)
        try {
          tgLocal.setToolConfiguration?.(StackScrollTool.toolName, {
            ...STACK_SCROLL_CONFIGURATION,
          });

          // make wheel scroll active by default so users can scroll stacks
          tgLocal.setToolActive?.(StackScrollTool.toolName, {
            bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }],
          });
        } catch {
          // ignore config errors
        }
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

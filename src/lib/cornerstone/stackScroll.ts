'use client';

import {
  Enums as ToolEnums,
  StackScrollTool,
  ToolGroupManager,
} from '@cornerstonejs/tools';

import { TOOL_GROUP } from '@/constants/toolgroup';

/**
 * Match OHIF's stack navigation semantics:
 * - wheel remains independent from the primary mouse tool;
 * - unloaded images are debounced by Cornerstone's target-index queue;
 * - manual wheel navigation stops at the stack boundaries.
 *
 * Cine has its own loop option in useCine and is intentionally unaffected.
 */
export const STACK_SCROLL_CONFIGURATION = Object.freeze({
  invert: false,
  debounceIfNotLoaded: true,
  loop: false,
});

export const STACK_SCROLL_WHEEL_BINDINGS = Object.freeze([
  Object.freeze({ mouseButton: ToolEnums.MouseBindings.Wheel }),
]);

function toolGroupHasStackScroll(toolGroup: any): boolean {
  if (!toolGroup) return false;

  try {
    if (typeof toolGroup.hasTool === 'function') {
      return Boolean(toolGroup.hasTool(StackScrollTool.toolName));
    }
  } catch {}

  try {
    if (typeof toolGroup.getToolInstance === 'function') {
      return Boolean(toolGroup.getToolInstance(StackScrollTool.toolName));
    }
  } catch {}

  try {
    const instances = toolGroup.getToolInstances?.() ?? toolGroup._toolInstances;
    return Boolean(instances?.[StackScrollTool.toolName]);
  } catch {
    return false;
  }
}
/**
 * Idempotently keeps Cornerstone's native wheel navigation active.
 *
 * This deliberately does not attach a DOM `wheel` listener. Cornerstone owns
 * wheel normalization, target-frame accumulation, cache-aware loading and the
 * STACK_NEW_IMAGE event that the rest of the viewer already consumes.
 */
export function ensureStackScrollWheelActive(
  toolGroupId: string = TOOL_GROUP
): boolean {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
  if (!toolGroup) return false;

  try {
    if (
      !toolGroupHasStackScroll(toolGroup) &&
      typeof (toolGroup as any).addTool === 'function'
    ) {
      (toolGroup as any).addTool(StackScrollTool.toolName);
    }

    toolGroup.setToolConfiguration?.(StackScrollTool.toolName, {
      ...STACK_SCROLL_CONFIGURATION,
    });
    toolGroup.setToolActive?.(StackScrollTool.toolName, {
      bindings: STACK_SCROLL_WHEEL_BINDINGS.map((binding) => ({ ...binding })),
    });
    return true;
  } catch {
    return false;
  }
}

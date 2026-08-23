'use client';

import {
  AdvancedMagnifyTool,
  ToolGroupManager,
  annotation as csAnnotation,
} from '@cornerstonejs/tools';

import { enableAdvancedMagnifyFrameScheduling } from './performance';

/**
 * Keep the loupe behaviour in one place so toolbar wiring does not need to
 * know about Cornerstone's viewport implementation details.
 */
const ADVANCED_MAGNIFY_CONFIGURATION = {
  magnifyingGlass: {
    radius: 125,
    zoomFactor: 3,
    zoomFactorList: [1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5],
    autoPan: {
      enabled: true,
      padding: 10,
    },
  },
} as const;

const ADVANCED_MAGNIFY_STYLE = {
  // Match Cornerstone/OHIF's loupe states instead of inheriting the green
  // measurement colour configured for clinical annotations in this viewer.
  color: 'rgb(255, 255, 0)',
  colorHighlighted: 'rgb(0, 255, 0)',
  colorSelected: 'rgb(0, 255, 0)',
  colorLocked: 'rgb(209, 193, 90)',
  shadow: true,
} as const;

export function configureAdvancedMagnifyToolGroup(toolGroupId: string): void {
  try {
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    toolGroup?.setToolConfiguration?.(
      AdvancedMagnifyTool.toolName,
      ADVANCED_MAGNIFY_CONFIGURATION
    );
    enableAdvancedMagnifyFrameScheduling(
      toolGroup?.getToolInstance?.(AdvancedMagnifyTool.toolName)
    );
  } catch {
    // Configuration is best-effort; registration must not break the viewer.
  }

  try {
    const style = csAnnotation.config?.style;
    const existingStyles = style?.getToolGroupToolStyles?.(toolGroupId) ?? {};
    const toolName = AdvancedMagnifyTool.toolName;

    style?.setToolGroupToolStyles?.(toolGroupId, {
      ...existingStyles,
      [toolName]: {
        ...(existingStyles[toolName] ?? {}),
        ...ADVANCED_MAGNIFY_STYLE,
      },
    });
  } catch {
    // Styling is visual-only and must not block tool activation.
  }
}

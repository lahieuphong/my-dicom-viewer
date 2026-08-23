'use client';

import {
  ToolGroupManager,
  annotation as csAnnotation,
} from '@cornerstonejs/tools';

import { WindowLevelRegionTool } from './WindowLevelRegionTool';

const WINDOW_LEVEL_REGION_CONFIGURATION = {
  minWindowWidth: 10,
} as const;

const WINDOW_LEVEL_REGION_STYLE = {
  color: 'rgb(0, 255, 0)',
  colorHighlighted: 'rgb(0, 255, 0)',
  colorSelected: 'rgb(0, 255, 0)',
  lineWidth: '2',
  lineDash: '4,4',
  shadow: true,
} as const;

export function configureWindowLevelRegionToolGroup(
  toolGroupId: string
): void {
  try {
    const toolGroup = ToolGroupManager.getToolGroup(toolGroupId);
    toolGroup?.setToolConfiguration?.(
      WindowLevelRegionTool.toolName,
      WINDOW_LEVEL_REGION_CONFIGURATION
    );
  } catch {
    // Configuration is best-effort and must not block viewer startup.
  }

  try {
    const style = csAnnotation.config?.style;
    const existingStyles = style?.getToolGroupToolStyles?.(toolGroupId) ?? {};
    const toolName = WindowLevelRegionTool.toolName;

    style?.setToolGroupToolStyles?.(toolGroupId, {
      ...existingStyles,
      [toolName]: {
        ...(existingStyles[toolName] ?? {}),
        ...WINDOW_LEVEL_REGION_STYLE,
      },
    });
  } catch {
    // Styling is visual-only and must not block tool activation.
  }
}

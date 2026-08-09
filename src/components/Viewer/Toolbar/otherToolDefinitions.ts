import type { ReactNode, SVGProps } from 'react';
import {
  ArrowLeftRight,
  ChevronRight,
  CirclePlay,
  RotateCcw,
  RotateCw,
  type LucideIcon,
} from 'lucide-react';

import type { ToolID } from '@/hooks/useToolManager';

import { InvertIcon } from './OtherToolIcons';

export const OTHER_TOOL_IDS = [
  'angle',
  'rotate90',
  'flipHorizontal',
  'reset',
] as const satisfies readonly ToolID[];

export type OtherToolID = (typeof OTHER_TOOL_IDS)[number];
export type OtherViewportToggleID = 'cine' | 'invert';
export type OtherItemID = OtherToolID | OtherViewportToggleID;
export type OtherItemKind =
  | 'mouse-tool'
  | 'viewport-toggle'
  | 'viewport-action';

export type OtherToolIcon =
  | LucideIcon
  | ((props: SVGProps<SVGSVGElement>) => ReactNode);

export type OtherToolDefinition = {
  id: OtherItemID;
  menuLabel: string;
  label: string;
  detail: string;
  Icon: OtherToolIcon;
  kind: OtherItemKind;
  disabledForSR: boolean;
};

export const OTHER_TOOL_DEFINITIONS = {
  cine: {
    id: 'cine',
    menuLabel: 'Cine',
    label: 'Cine',
    detail: 'Cine Controls',
    Icon: CirclePlay,
    kind: 'viewport-toggle',
    disabledForSR: true,
  },
  invert: {
    id: 'invert',
    menuLabel: 'Ảnh dương bản',
    label: 'Ảnh dương bản',
    detail: 'Invert Colors',
    Icon: InvertIcon,
    kind: 'viewport-toggle',
    disabledForSR: false,
  },
  angle: {
    id: 'angle',
    menuLabel: 'Angle',
    label: 'Thước đo góc',
    detail: 'Angle Tool',
    Icon: ChevronRight,
    kind: 'mouse-tool',
    disabledForSR: true,
  },
  rotate90: {
    id: 'rotate90',
    menuLabel: 'Rotate 90°',
    label: 'Xoay ảnh sang phải 90°',
    detail: 'Rotate Right',
    Icon: RotateCw,
    kind: 'viewport-action',
    disabledForSR: false,
  },
  flipHorizontal: {
    id: 'flipHorizontal',
    menuLabel: 'Flip Horizontal',
    label: 'Lật ảnh theo chiều ngang',
    detail: 'Flip Horizontal',
    Icon: ArrowLeftRight,
    kind: 'viewport-action',
    disabledForSR: false,
  },
  reset: {
    id: 'reset',
    menuLabel: 'Reset View',
    label: 'Đặt lại khung nhìn',
    detail: 'Reset View',
    Icon: RotateCcw,
    kind: 'viewport-action',
    disabledForSR: false,
  },
} as const satisfies Record<OtherItemID, OtherToolDefinition>;

/** Display order used by the Other Tools menu. */
export const OTHER_TOOL_ITEMS: readonly OtherToolDefinition[] = [
  OTHER_TOOL_DEFINITIONS.cine,
  OTHER_TOOL_DEFINITIONS.invert,
  OTHER_TOOL_DEFINITIONS.angle,
  OTHER_TOOL_DEFINITIONS.rotate90,
  OTHER_TOOL_DEFINITIONS.flipHorizontal,
  OTHER_TOOL_DEFINITIONS.reset,
];

export function isOtherTool(tool: ToolID): tool is OtherToolID {
  return (OTHER_TOOL_IDS as readonly ToolID[]).includes(tool);
}

export function getOtherToolDefinition(
  item: OtherItemID
): OtherToolDefinition {
  return OTHER_TOOL_DEFINITIONS[item];
}

/**
 * Resolves the icon/copy shown on the combined Other Tools trigger.
 * Viewport toggles remain displayable only while their real viewport state is on.
 */
export function resolveDisplayedOtherItem(
  lastSelectedItem: OtherItemID | null,
  activeTool: ToolID,
  isCineOpen: boolean,
  isInverted: boolean
): OtherItemID | null {
  if (lastSelectedItem === 'cine' && isCineOpen) return 'cine';
  if (lastSelectedItem === 'invert' && isInverted) return 'invert';
  if (
    lastSelectedItem !== null &&
    lastSelectedItem !== 'cine' &&
    lastSelectedItem !== 'invert' &&
    activeTool === lastSelectedItem
  ) {
    return lastSelectedItem;
  }

  if (isOtherTool(activeTool)) return activeTool;
  if (isCineOpen) return 'cine';
  return isInverted ? 'invert' : null;
}

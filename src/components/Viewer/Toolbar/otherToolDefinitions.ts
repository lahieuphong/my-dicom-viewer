import type { ReactNode, SVGProps } from 'react';
import {
  ArrowLeftRight,
  ChevronRight,
  CirclePlay,
  ListTree,
  RotateCcw,
  RotateCw,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';

import type { ToolID } from '@/hooks/useToolManager';

import {
  CalibrationIcon,
  CobbAngleIcon,
  InvertIcon,
  ProbeIcon,
} from './OtherToolIcons';

export const OTHER_TOOL_IDS = [
  'probe',
  'angle',
  'cobbAngle',
  'magnify',
  'advancedMagnify',
  'calibrationLine',
  'rotate90',
  'flipHorizontal',
  'reset',
] as const satisfies readonly ToolID[];

export type OtherToolID = (typeof OTHER_TOOL_IDS)[number];
export type OtherViewportToggleID = 'cine' | 'invert';
export type OtherDialogActionID = 'dicomTagBrowser';
export type OtherItemID =
  | OtherToolID
  | OtherViewportToggleID
  | OtherDialogActionID;
export type OtherItemKind =
  | 'mouse-tool'
  | 'viewport-toggle'
  | 'viewport-action'
  | 'dialog-action';

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
  probe: {
    id: 'probe',
    menuLabel: 'Thông tin điểm ảnh',
    label: 'Thông tin điểm ảnh',
    detail: 'Probe Tool',
    Icon: ProbeIcon,
    kind: 'mouse-tool',
    disabledForSR: true,
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
  cobbAngle: {
    id: 'cobbAngle',
    menuLabel: 'Cobb Angle',
    label: 'Thước đo góc Cobb',
    detail: 'Cobb Angle Tool',
    Icon: CobbAngleIcon,
    kind: 'mouse-tool',
    disabledForSR: true,
  },
  magnify: {
    id: 'magnify',
    menuLabel: 'Zoom-in',
    label: 'Zoom-in',
    detail: 'Magnify Tool',
    Icon: ZoomIn,
    kind: 'mouse-tool',
    disabledForSR: true,
  },
  advancedMagnify: {
    id: 'advancedMagnify',
    menuLabel: 'Magnify Probe',
    label: 'Kính lúp thăm dò',
    detail: 'Advanced Magnify Tool',
    Icon: ZoomIn,
    kind: 'mouse-tool',
    disabledForSR: true,
  },
  calibrationLine: {
    id: 'calibrationLine',
    menuLabel: 'Calibration',
    label: 'Hiệu chuẩn khoảng cách',
    detail: 'Calibration Line',
    Icon: CalibrationIcon,
    kind: 'mouse-tool',
    disabledForSR: true,
  },
  dicomTagBrowser: {
    id: 'dicomTagBrowser',
    menuLabel: 'DICOM Tag Browser',
    label: 'DICOM Tag Browser',
    detail: 'Browse DICOM Metadata',
    Icon: ListTree,
    kind: 'dialog-action',
    disabledForSR: false,
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
  OTHER_TOOL_DEFINITIONS.reset,
  OTHER_TOOL_DEFINITIONS.rotate90,
  OTHER_TOOL_DEFINITIONS.flipHorizontal,
  OTHER_TOOL_DEFINITIONS.invert,
  OTHER_TOOL_DEFINITIONS.probe,
  OTHER_TOOL_DEFINITIONS.cine,
  OTHER_TOOL_DEFINITIONS.angle,
  OTHER_TOOL_DEFINITIONS.cobbAngle,
  OTHER_TOOL_DEFINITIONS.magnify,
  OTHER_TOOL_DEFINITIONS.calibrationLine,
  OTHER_TOOL_DEFINITIONS.dicomTagBrowser,
  OTHER_TOOL_DEFINITIONS.advancedMagnify,
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
    lastSelectedItem !== 'dicomTagBrowser' &&
    activeTool === lastSelectedItem
  ) {
    return lastSelectedItem;
  }

  if (isOtherTool(activeTool)) return activeTool;
  if (isCineOpen) return 'cine';
  return isInverted ? 'invert' : null;
}

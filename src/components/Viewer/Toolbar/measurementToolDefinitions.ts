import type { ToolID } from '@/hooks/useToolManager';

import {
  AnnotationIcon,
  BidirectionalIcon,
  CircleIcon,
  EllipseIcon,
  FreehandRoiIcon,
  LengthIcon,
  LivewireIcon,
  RectangleIcon,
  SplineRoiIcon,
  type MeasurementToolIcon,
} from './MeasurementToolIcons';

export type MeasurementMenuTool = {
  id: ToolID;
  label: string;
  detail: string;
  Icon: MeasurementToolIcon;
};

/** Exact order and labels used by OHIF's basic viewer Measurement section. */
export const MEASUREMENT_MENU_TOOLS: readonly MeasurementMenuTool[] = [
  {
    id: 'length',
    label: 'Thước đo chiều dài',
    detail: 'Length Tool',
    Icon: LengthIcon,
  },
  {
    id: 'bidirectional',
    label: 'Hai hướng',
    detail: 'Bidirectional Tool',
    Icon: BidirectionalIcon,
  },
  {
    id: 'arrowAnnotate',
    label: 'Annotation',
    detail: 'Arrow Annotate Tool',
    Icon: AnnotationIcon,
  },
  {
    id: 'ellipticalROI',
    label: 'Đo Elip',
    detail: 'Elliptical ROI Tool',
    Icon: EllipseIcon,
  },
  {
    id: 'rectangleROI',
    label: 'Đo chữ nhật',
    detail: 'Rectangle ROI Tool',
    Icon: RectangleIcon,
  },
  {
    id: 'circleROI',
    label: 'Vòng tròn',
    detail: 'Circle ROI Tool',
    Icon: CircleIcon,
  },
  {
    id: 'planarFreehandROI',
    label: 'Freehand ROI',
    detail: 'Planar Freehand ROI Tool',
    Icon: FreehandRoiIcon,
  },
  {
    id: 'splineROI',
    label: 'Spline ROI',
    detail: 'Spline ROI Tool',
    Icon: SplineRoiIcon,
  },
  {
    id: 'livewireContour',
    label: 'Livewire tool',
    detail: 'Livewire Contour Tool',
    Icon: LivewireIcon,
  },
];

export const MEASUREMENT_MENU_TOOL_IDS = MEASUREMENT_MENU_TOOLS.map(
  ({ id }) => id
);

export function getMeasurementMenuTool(
  tool: ToolID
): MeasurementMenuTool | undefined {
  return MEASUREMENT_MENU_TOOLS.find(({ id }) => id === tool);
}

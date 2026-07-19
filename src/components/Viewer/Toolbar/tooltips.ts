import type { ToolID } from '@/hooks/useToolManager';

export type ToolbarTooltipCopy = {
  label: string;
  detail: string;
};

const TOOL_TOOLTIP_COPY: Partial<Record<ToolID, ToolbarTooltipCopy>> = {
  adjust: {
    label: 'Điều chỉnh sáng / tương phản',
    detail: 'Window/Level Tool',
  },
  pan: {
    label: 'Di chuyển ảnh',
    detail: 'Pan Tool',
  },
  zoom: {
    label: 'Phóng to / thu nhỏ',
    detail: 'Zoom Tool',
  },
  length: {
    label: 'Thước đo chiều dài',
    detail: 'Length Tool',
  },
  bidirectional: {
    label: 'Đo hai chiều',
    detail: 'Bidirectional Tool',
  },
  arrowAnnotate: {
    label: 'Chú thích mũi tên',
    detail: 'Arrow Annotation Tool',
  },
  ellipticalROI: {
    label: 'Vùng quan tâm hình elip',
    detail: 'Elliptical ROI Tool',
  },
  rectangleROI: {
    label: 'Vùng quan tâm hình chữ nhật',
    detail: 'Rectangle ROI Tool',
  },
  circleROI: {
    label: 'Vùng quan tâm hình tròn',
    detail: 'Circle ROI Tool',
  },
  splineROI: {
    label: 'Vùng quan tâm đường cong',
    detail: 'Spline ROI Tool',
  },
  angle: {
    label: 'Thước đo góc',
    detail: 'Angle Tool',
  },
  rotate90: {
    label: 'Xoay ảnh sang phải 90°',
    detail: 'Rotate Right',
  },
  flipHorizontal: {
    label: 'Lật ảnh theo chiều ngang',
    detail: 'Flip Horizontal',
  },
  reset: {
    label: 'Đặt lại khung nhìn',
    detail: 'Reset View',
  },
};

export const MEASUREMENT_TOOLS_TOOLTIP: ToolbarTooltipCopy = {
  label: 'Công cụ đo lường',
  detail: 'Measurement Tools',
};

export const MORE_TOOLS_TOOLTIP: ToolbarTooltipCopy = {
  label: 'Công cụ khác',
  detail: 'More Tools',
};

export const CAPTURE_TOOLTIP: ToolbarTooltipCopy = {
  label: 'Chụp ảnh',
  detail: 'Image Capture',
};

export function getToolTooltip(
  tool: ToolID,
  fallback: ToolbarTooltipCopy
): ToolbarTooltipCopy {
  return TOOL_TOOLTIP_COPY[tool] ?? fallback;
}

export function getCineTooltip(
  isPlaying: boolean,
  isLoading: boolean
): ToolbarTooltipCopy {
  if (isLoading) {
    return { label: 'Đang tải chuỗi ảnh', detail: 'Loading Cine' };
  }

  return isPlaying
    ? { label: 'Tạm dừng chuỗi ảnh', detail: 'Pause Cine' }
    : { label: 'Phát chuỗi ảnh', detail: 'Play Cine' };
}

export function getFpsTooltip(fps: number): ToolbarTooltipCopy {
  return {
    label: 'Tốc độ phát',
    detail: `${fps} FPS`,
  };
}


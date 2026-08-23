import { VIEWPORT_ID } from '@/constants/viewport';

export type ViewportGridLayout = {
  rows: number;
  columns: number;
};

export const MAX_VIEWPORT_ROWS = 3;
export const MAX_VIEWPORT_COLUMNS = 4;

export const DEFAULT_VIEWPORT_LAYOUT: ViewportGridLayout = {
  rows: 1,
  columns: 1,
};

export const COMMON_VIEWPORT_LAYOUTS: readonly ViewportGridLayout[] = [
  { rows: 1, columns: 1 },
  { rows: 1, columns: 2 },
  { rows: 2, columns: 2 },
  { rows: 2, columns: 3 },
];

function clampInteger(value: number, minimum: number, maximum: number) {
  const normalized = Math.round(Number(value) || minimum);
  return Math.min(maximum, Math.max(minimum, normalized));
}

export function normalizeViewportLayout(
  layout: ViewportGridLayout
): ViewportGridLayout {
  return {
    rows: clampInteger(layout.rows, 1, MAX_VIEWPORT_ROWS),
    columns: clampInteger(layout.columns, 1, MAX_VIEWPORT_COLUMNS),
  };
}

export function getViewportCount(layout: ViewportGridLayout): number {
  const normalized = normalizeViewportLayout(layout);
  return normalized.rows * normalized.columns;
}

/** Keep the legacy primary ID stable; extra panes get deterministic IDs. */
export function getViewportIdAt(index: number): string {
  return index === 0 ? VIEWPORT_ID : `${VIEWPORT_ID}_${index + 1}`;
}

export function getViewportLabelAt(index: number): string {
  return String.fromCharCode(65 + Math.max(0, index));
}

export function isSameViewportLayout(
  first: ViewportGridLayout,
  second: ViewportGridLayout
): boolean {
  return first.rows === second.rows && first.columns === second.columns;
}

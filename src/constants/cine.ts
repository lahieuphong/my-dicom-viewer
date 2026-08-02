export const DEFAULT_CINE_FPS = 24;
export const MIN_CINE_FPS = 1;
export const MAX_CINE_FPS = 90;
export const CINE_FPS_UPDATE_DELAY_MS = 100;

export function clampCineFps(value: number) {
  return Math.max(MIN_CINE_FPS, Math.min(MAX_CINE_FPS, Math.round(value)));
}

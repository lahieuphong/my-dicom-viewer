export const DEFAULT_CINE_FPS = 24;
export const MIN_CINE_FPS = 1;
export const MAX_CINE_FPS = 90;
export const CINE_FPS_UPDATE_DELAY_MS = 100;

// Cornerstone's default (30) can hold high-FPS stack playback on the same
// frame for many timer ticks while a render is settling. Zero still gives the
// renderer one tick to finish, then lets the Cine target continue advancing.
export const CINE_WAIT_FOR_RENDERED_TICKS = 0;

export function clampCineFps(value: number) {
  return Math.max(MIN_CINE_FPS, Math.min(MAX_CINE_FPS, Math.round(value)));
}

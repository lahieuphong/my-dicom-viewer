// src/lib/viewer/constants.ts
export const ATTEMPTS_ATTACH = 2;     // viewer-level attach attempts (attachDisplaySetToViewport -> retry)
export const ATTEMPTS_ENGINE = 2;     // attempts used when waiting/finding rendering engine/viewport
export const ATTEMPTS_SETSTACK = 3;   // aggressive attempts for setStack / engine.setStacks
export const ATTEMPTS_POLL = 6;       // polling attempts for enabled element to get image
export const ATTEMPTS_ANNOT = 6;      // attempts to attach annotation instance
export const DEFAULT_SETTLE_MS = 120; // settle delay (ms)
export const USER_COOLDOWN_MS = 3000; // cooldown after user interaction (ms)
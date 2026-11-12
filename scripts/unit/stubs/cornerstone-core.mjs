// Stand-in for @cornerstonejs/core in unit tests, which run without a
// browser. Export only what modules under test import at load time.
export function getEnabledElement() {
  return undefined;
}

// Cornerstone's event target; tests dispatch the events modules listen for.
export const eventTarget = new EventTarget();

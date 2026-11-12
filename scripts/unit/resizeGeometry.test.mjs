import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canvasBufferNeedsResize,
  getCameraForResizedElement,
  getCameraForStaleCanvas,
} from '../../src/lib/viewer/resizeGeometry.ts';

const camera = (parallelScale, extra = {}) => ({
  parallelScale,
  focalPoint: [1, 2, 3],
  position: [1, 2, 503],
  ...extra,
});

// A parallel projection shows 2 * parallelScale world units over the
// element's height.
const pixelsPerWorldUnit = (parallelScale, size) => size.height / (2 * parallelScale);

test('the resized camera keeps the frame at the size object-fit: contain shows it', () => {
  const previous = { width: 800, height: 600 };
  for (const next of [
    { width: 400, height: 600 },
    { width: 800, height: 300 },
    { width: 400, height: 300 },
    { width: 1200, height: 700 },
    { width: 640, height: 900 },
  ]) {
    const result = getCameraForResizedElement(camera(100), previous, next);
    const visibleScale = Math.min(next.width / previous.width, next.height / previous.height);
    assert.ok(
      Math.abs(
        pixelsPerWorldUnit(result.parallelScale, next) -
          pixelsPerWorldUnit(100, previous) * visibleScale
      ) < 1e-9,
      `${next.width}x${next.height}`
    );
  }
});

test('a narrower element keeps the frame height and so shows more of the world', () => {
  const result = getCameraForResizedElement(
    camera(100),
    { width: 800, height: 600 },
    { width: 400, height: 600 }
  );
  assert.equal(result.parallelScale, 200);
  const proportional = getCameraForResizedElement(
    camera(100),
    { width: 800, height: 600 },
    { width: 400, height: 300 }
  );
  assert.equal(proportional.parallelScale, 100);
});

test('the resized camera keeps every other field and leaves its input alone', () => {
  const input = camera(100, { flipHorizontal: true, viewUp: [0, -1, 0] });
  const result = getCameraForResizedElement(
    input,
    { width: 800, height: 600 },
    { width: 400, height: 600 }
  );
  assert.deepEqual({ ...result, parallelScale: 100 }, input);
  assert.equal(input.parallelScale, 100);
  assert.notEqual(result, input);
});

test('the resized camera is null when the input cannot be converted', () => {
  const previous = { width: 800, height: 600 };
  const next = { width: 400, height: 300 };
  assert.equal(getCameraForResizedElement(null, previous, next), null);
  assert.equal(getCameraForResizedElement(camera(100), null, next), null);
  for (const parallelScale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
    assert.equal(
      getCameraForResizedElement(camera(parallelScale), previous, next),
      null,
      `parallelScale ${parallelScale}`
    );
  }
  assert.equal(getCameraForResizedElement(camera(100), { width: 0, height: 600 }, next), null);
  assert.equal(getCameraForResizedElement(camera(100), previous, { width: 0, height: 300 }), null);
});

test('a backing buffer needs a resize unless it is the CSS box times the pixel ratio, truncated', () => {
  const box = { clientWidth: 333, clientHeight: 201 };
  assert.equal(canvasBufferNeedsResize({ ...box, width: 499, height: 301 }, 1.5), false);
  assert.equal(canvasBufferNeedsResize({ ...box, width: 500, height: 301 }, 1.5), true);
  assert.equal(canvasBufferNeedsResize({ ...box, width: 333, height: 201 }, 1), false);
  assert.equal(canvasBufferNeedsResize({ ...box, width: 333, height: 201 }, 2), true);
  assert.equal(
    canvasBufferNeedsResize({ clientWidth: 0, clientHeight: 201, width: 10, height: 10 }, 1),
    false,
    'a hidden canvas never needs one'
  );
});

test('the stale-canvas camera derives the old size from the buffer in device pixels', () => {
  // A 2x display: the buffer still holds an 800x600 CSS frame.
  const canvas = { clientWidth: 400, clientHeight: 600, width: 1600, height: 1200 };
  const result = getCameraForStaleCanvas(camera(100), canvas, 2);
  assert.equal(result.parallelScale, 200);
  assert.deepEqual(
    getCameraForStaleCanvas(camera(100), canvas, 2),
    result,
    'the same buffer gives the same camera however often it is applied'
  );
  assert.equal(
    getCameraForStaleCanvas(camera(100), { ...canvas, width: 800, height: 1200 }, 2),
    null,
    'a buffer that matches its box keeps the camera'
  );
});

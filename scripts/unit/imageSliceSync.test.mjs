import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findClosestImageIndex } from '../../src/lib/cornerstone/imageSliceSync/closestImage.ts';
import {
  getRegisteredImagePosition,
  registerImagePositions,
} from '../../src/lib/cornerstone/imageSliceSync/imagePositions.ts';

// An axial stack 2.5 mm apart along z.
const axial = [0, 1, 2, 3, 4].map((index) => [10, -20, index * 2.5]);

test('the closest slice is the one nearest to the point in patient space', () => {
  assert.equal(findClosestImageIndex(axial, [10, -20, 0]), 0);
  assert.equal(findClosestImageIndex(axial, [10, -20, 6.1]), 2);
  assert.equal(findClosestImageIndex(axial, [10, -20, 6.4]), 3);
  assert.equal(findClosestImageIndex(axial, [40, 90, 9.9]), 4, 'an in-plane offset does not change the nearest slice');
  assert.equal(findClosestImageIndex(axial, [10, -20, -100]), 0, 'a point past the stack picks its end');
});

test('slices without a position are skipped and a tie keeps the first slice', () => {
  assert.equal(findClosestImageIndex([null, axial[1], undefined, axial[3]], [10, -20, 5]), 1, 'midway between two slices');
  assert.equal(findClosestImageIndex([axial[0], [10, -20]], [10, -20, 0.1]), 0, 'a 2D position is not a position');
  assert.equal(findClosestImageIndex([null, undefined], [0, 0, 0]), -1);
  assert.equal(findClosestImageIndex([], [0, 0, 0]), -1);
});

test('typed-array positions, as gl-matrix returns them, work too', () => {
  const positions = axial.map((position) => Float32Array.from(position));
  assert.equal(findClosestImageIndex(positions, Float32Array.of(10, -20, 7.4)), 3);
});

test('only finite three-component positions are registered', () => {
  registerImagePositions([
    ['image:a', [1, 2, 3]],
    ['image:b', ['4', '5.5', '-6']],
    ['image:c', [1, 2]],
    ['image:d', [1, Number.NaN, 3]],
    ['image:e', undefined],
    ['', [7, 8, 9]],
  ]);
  assert.deepEqual(getRegisteredImagePosition('image:a'), [1, 2, 3]);
  assert.deepEqual(getRegisteredImagePosition('image:b'), [4, 5.5, -6], 'DICOM strings become numbers');
  for (const imageId of ['image:c', 'image:d', 'image:e', '', 'image:unknown']) {
    assert.equal(getRegisteredImagePosition(imageId), null, JSON.stringify(imageId));
  }
});

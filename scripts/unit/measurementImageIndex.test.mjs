import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveMeasurementImageIndex } from '../../src/lib/viewer/measurementImageIndex.ts';

const image = (file, query = '') => `wadouri:http://viewer.test/dicoms/s1/${file}.dcm${query}`;
const stack = [image('1'), image('2'), image('3'), image('4')];

test('the live annotation reference wins over the measurement and its data', () => {
  assert.equal(
    resolveMeasurementImageIndex(
      { metadata: { referencedImageId: image('2') }, data: { imageId: image('4') } },
      stack,
      { metadata: { referencedImageId: image('3') } }
    ),
    2
  );
});

test('the measurement and then its data are used when the annotation has no match', () => {
  assert.equal(
    resolveMeasurementImageIndex(
      { metadata: { referencedImageId: image('2') } },
      stack,
      { metadata: { referencedImageId: image('9') } }
    ),
    1
  );
  assert.equal(resolveMeasurementImageIndex({ data: { referencedImageId: image('4') } }, stack), 3);
  // A cache-busting query does not stop a match.
  assert.equal(
    resolveMeasurementImageIndex({ metadata: { imageId: image('3', '?cacheBust=1') } }, stack),
    2
  );
});

test('the recorded frame index picks the frame of a multi-frame file', () => {
  const frames = [image('m', '?frame=1'), image('m', '?frame=2'), image('m', '?frame=3')];
  assert.equal(
    resolveMeasurementImageIndex({ metadata: { referencedImageId: image('m'), frameIndex: 2 } }, frames),
    2
  );
  assert.equal(
    resolveMeasurementImageIndex({ metadata: { referencedImageId: image('m', '?frame=2') } }, frames),
    1
  );
});

test('without a matching reference the recorded frame index is used, clamped to the stack', () => {
  assert.equal(resolveMeasurementImageIndex({ metadata: { frameIndex: 2 } }, stack), 2);
  assert.equal(resolveMeasurementImageIndex({ metadata: { frameIndex: 9 } }, stack), 3);
  assert.equal(resolveMeasurementImageIndex({ metadata: { frameIndex: -1 } }, stack), 0);
  assert.equal(resolveMeasurementImageIndex({ metadata: { frameIndex: 1.5 } }, stack), 0);
  assert.equal(resolveMeasurementImageIndex({}, stack), 0);
  assert.equal(resolveMeasurementImageIndex(null, []), 0);
});

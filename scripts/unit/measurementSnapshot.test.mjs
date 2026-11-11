import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  mergeMeasurementSnapshot,
  resolveSeriesFromImageId,
} from '../../src/modes/basic-viewer/application/measurementSnapshot.ts';

const image = (series, file) => `wadouri:http://viewer.test/dicoms/${series}/${file}.dcm`;
const seriesMap = {
  S1: { files: [image('s1', '1'), image('s1', '2')] },
  S2: { files: [image('s2', '1')] },
};

function measurement(annotationUID, metadata = {}, extra = {}) {
  return {
    annotationUID,
    toolName: 'Length',
    type: 'length',
    label: 'L',
    data: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    metadata: { studyUID: 'ST', viewportId: 'VP', createdAt: '', ...metadata },
    ...extra,
  };
}

const merge = (previous, current, options = {}) =>
  mergeMeasurementSnapshot(previous, current, {
    seriesMap,
    isRemoved: () => false,
    ...options,
  });

test('a new measurement is attributed to the series and frame of its image', () => {
  const [result] = merge([], [
    measurement('m1', { seriesUID: '', referencedImageId: image('s1', '2') }, { label: undefined }),
  ]);
  assert.equal(result.metadata.seriesUID, 'S1');
  assert.equal(result.metadata.frameIndex, 1);
  assert.equal(result.label, '');
});

test('a new measurement keeps the frame index it already has', () => {
  const [result] = merge([], [
    measurement('m1', { seriesUID: 'S1', frameIndex: 0, referencedImageId: image('s1', '2') }),
  ]);
  assert.equal(result.metadata.frameIndex, 0);
});

test('an update without a known series keeps the series it had', () => {
  const previous = [measurement('m1', { seriesUID: 'S2', frameIndex: 0 })];
  for (const seriesUID of ['', 'UNKNOWN']) {
    const [result] = merge(previous, [measurement('m1', { seriesUID, frameIndex: 0 })]);
    assert.equal(result.metadata.seriesUID, 'S2', `seriesUID ${JSON.stringify(seriesUID)}`);
  }
});

test('an out-of-range frame index is re-resolved from the referenced image', () => {
  const previous = [measurement('m1', { seriesUID: 'S1', frameIndex: 0 })];
  const [resolved] = merge(previous, [
    measurement('m1', { seriesUID: 'S1', frameIndex: 9, referencedImageId: image('s1', '2') }),
  ]);
  assert.equal(resolved.metadata.frameIndex, 1);

  const [clamped] = merge(
    [measurement('m1', { seriesUID: 'S1', frameIndex: 7 })],
    [measurement('m1', { seriesUID: 'S1', frameIndex: 9, referencedImageId: image('s9', '9') })]
  );
  assert.equal(clamped.metadata.frameIndex, 1, 'falls back to the old index, clamped to the stack');
});

test('a removed measurement never comes back', () => {
  const result = merge(
    [measurement('gone', { seriesUID: 'S1' }), measurement('kept', { seriesUID: 'S1' })],
    [measurement('gone', { seriesUID: 'S1' })],
    { isRemoved: (uid) => uid === 'gone' }
  );
  assert.deepEqual(result.map(({ annotationUID }) => annotationUID), ['kept']);
});

test('a measurement missing from the snapshot stays while the annotation runtime has it', () => {
  const previous = [
    measurement('alive', { seriesUID: 'S1' }),
    measurement('cancelled', { seriesUID: 'S1' }),
    measurement('unknown', { seriesUID: 'S1' }),
  ];
  const result = merge(previous, [], {
    getAnnotation: (uid) => {
      if (uid === 'unknown') throw new Error('lookup failed');
      return uid === 'alive' ? { annotationUID: uid } : undefined;
    },
  });
  assert.deepEqual(result.map(({ annotationUID }) => annotationUID), ['alive', 'unknown']);
  assert.equal(merge(previous, []).length, 3, 'without a lookup every measurement stays');
});

test('resolveSeriesFromImageId matches by image, then by SOP file name', () => {
  assert.equal(resolveSeriesFromImageId(seriesMap, image('s2', '1')), 'S2');
  assert.equal(resolveSeriesFromImageId(seriesMap, 'imageId:http://elsewhere.test/2.dcm'), 'S1');
  assert.equal(resolveSeriesFromImageId(seriesMap, 'http://elsewhere.test/9.dcm'), undefined);
  assert.equal(resolveSeriesFromImageId(seriesMap, undefined), undefined);
});

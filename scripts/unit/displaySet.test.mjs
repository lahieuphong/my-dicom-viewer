import assert from 'node:assert/strict';
import { test } from 'node:test';

// createDisplaySetFromSeries resolves image IDs against the page origin.
globalThis.window ??= { location: { origin: 'http://viewer.test' } };

const { createDisplaySetFromSeries } = await import('../../src/lib/viewer/displaySet.ts');

const image = (name, query = '') => `wadouri:http://viewer.test/dicoms/${name}.dcm${query}`;

test('a series without instance numbers keeps the order of its files', () => {
  const files = [image('c'), image('a'), image('b')];
  const displaySet = createDisplaySetFromSeries({ files, metadata: { seriesInstanceUID: 'S1' } });
  assert.deepEqual(displaySet.imageIds, files);
  assert.equal(displaySet.initialImageIdIndex, 0);
  assert.equal(displaySet.seriesInstanceUID, 'S1');
});

test('instance numbers from per-file metadata order the stack; ties and gaps keep file order', () => {
  const files = [image('a'), image('b'), image('c'), image('d'), image('e')];
  const displaySet = createDisplaySetFromSeries({
    files,
    metadata: {
      instances: {
        [files[0]]: { instanceNumber: 3 },
        [files[1]]: { InstanceNumber: '1' },
        [files[2]]: { instanceNumber: 3 },
        [files[4]]: { instanceNumber: 'not a number' },
      },
    },
  });
  assert.deepEqual(displaySet.imageIds, [files[1], files[0], files[2], files[3], files[4]]);
});

test('an instanceNumber query parameter orders the stack too', () => {
  const files = [image('x', '?instanceNumber=2'), image('y', '?i=1')];
  assert.deepEqual(createDisplaySetFromSeries({ files }).imageIds, [files[1], files[0]]);
});

test('relative files become WADO-URI image IDs on the page origin', () => {
  const displaySet = createDisplaySetFromSeries({ files: ['/dicoms/a.dcm', 'dicomweb:x'] });
  assert.deepEqual(displaySet.imageIds, ['wadouri:http://viewer.test/dicoms/a.dcm', 'dicomweb:x']);
});

test('the initial VOI comes from the series window center and width', () => {
  const displaySet = createDisplaySetFromSeries({
    files: [image('a')],
    metadata: { windowCenter: 40, windowWidth: 400 },
  });
  assert.deepEqual(displaySet.initialVOIRange, { lower: -160, upper: 240 });
  assert.equal(createDisplaySetFromSeries({ files: [image('a')], metadata: { windowWidth: 0, windowCenter: 1 } }).initialVOIRange, null);
  assert.equal(createDisplaySetFromSeries(null), null);
});

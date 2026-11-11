import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  areImageStacksEqual,
  findMatchingImageIdIndex,
} from '../../src/lib/cornerstone/helpers.ts';

const base = 'wadouri:http://viewer.test/dicoms/mf.dcm';
const multiframe = [`${base}?frame=1`, `${base}?frame=2`, `${base}?frame=3`];

test('an exact reference wins, regardless of query order and cache busting', () => {
  const ids = ['wadouri:http://viewer.test/a.dcm?cacheBust=1&x=2', 'wadouri:http://viewer.test/b.dcm'];
  assert.equal(findMatchingImageIdIndex(ids, 'wadouri:http://viewer.test/a.dcm?x=2&cacheBust=1'), 0);
  assert.equal(findMatchingImageIdIndex(ids, 'imageId:wadouri:http://viewer.test/b.dcm'), 1);
});

test('a multiframe reference resolves its own frame', () => {
  assert.equal(findMatchingImageIdIndex(multiframe, `${base}?frame=2`), 1);
});

test('an ambiguous multiframe reference uses the stored frame index only for the same source', () => {
  assert.equal(findMatchingImageIdIndex(multiframe, base, 2), 2);
  assert.equal(findMatchingImageIdIndex(multiframe, base), -1, 'never picks an arbitrary frame');
  assert.equal(
    findMatchingImageIdIndex(['wadouri:http://viewer.test/other.dcm', ...multiframe], base, 0),
    -1,
    'a stored index pointing at another instance is ignored'
  );
});

test('a missing reference or stack matches nothing', () => {
  assert.equal(findMatchingImageIdIndex(multiframe, undefined), -1);
  assert.equal(findMatchingImageIdIndex(undefined, base), -1);
});

test('areImageStacksEqual compares frame-aware identities in order', () => {
  assert.equal(areImageStacksEqual(multiframe, [...multiframe]), true);
  assert.equal(areImageStacksEqual(multiframe, [...multiframe].reverse()), false);
  assert.equal(areImageStacksEqual(multiframe, multiframe.slice(0, 2)), false);
  assert.equal(areImageStacksEqual(null, multiframe), false);
});

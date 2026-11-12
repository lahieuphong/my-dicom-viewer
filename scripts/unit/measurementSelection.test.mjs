import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isMeasurementSelectionShown } from '../../src/modes/basic-viewer/application/measurementSelection.ts';
import { removeMeasurement } from '../../src/modes/basic-viewer/application/measurementRemoval.ts';

const image = (file) => `wadouri:http://viewer.test/dicoms/s1/${file}.dcm`;
const shownIn = (options) => (measurement) => isMeasurementSelectionShown(measurement, options);

test('a selection is shown while its measurement exists and is in the selected series', () => {
  const inSeries = shownIn({ activeSrId: null, selectedSeries: 'S1', seriesImageIds: [image('1')] });
  assert.equal(inSeries({ annotationUID: 'a', metadata: { seriesUID: 'S1' } }), true);
  assert.equal(inSeries({ annotationUID: 'a', metadata: { seriesUID: 'S2' } }), false);
  assert.equal(inSeries(undefined), false);
  // A measurement without a series falls back to its referenced image.
  assert.equal(inSeries({ annotationUID: 'a', metadata: { referencedImageId: image('1') } }), true);
  assert.equal(inSeries({ annotationUID: 'a', metadata: { referencedImageId: image('9') } }), false);
});

test('a selection follows the open SR: its own measurements while open, none of any SR otherwise', () => {
  const report = { annotationUID: 'r', metadata: { seriesUID: 'S1', reportSeriesUID: 'SR1' } };
  const local = { annotationUID: 'l', metadata: { seriesUID: 'S1' } };
  const withSr = shownIn({ activeSrId: 'SR1', selectedSeries: 'S1', seriesImageIds: [] });
  const withOtherSr = shownIn({ activeSrId: 'SR2', selectedSeries: 'S1', seriesImageIds: [] });
  const withoutSr = shownIn({ activeSrId: null, selectedSeries: 'S1', seriesImageIds: [] });
  assert.equal(withSr(report), true);
  assert.equal(withSr(local), false);
  assert.equal(withOtherSr(report), false);
  assert.equal(withoutSr(report), false);
  assert.equal(withoutSr(local), true);
});

function removalSteps({ selected = null, removes = true, stillRegistered = false } = {}) {
  const calls = [];
  let selectedUID = selected;
  const steps = {
    removeAnnotation: async (uid) => {
      calls.push(['remove', uid]);
      if (removes instanceof Error) throw removes;
      return removes;
    },
    hasAnnotation: () => stillRegistered,
    getSelectedUID: () => selectedUID,
    setSelectedUID: (uid) => { calls.push(['select', uid]); selectedUID = uid; },
    dropPendingSelection: (uid) => calls.push(['drop', uid]),
    forgetRemoved: (uid) => calls.push(['forget', uid]),
  };
  return { steps, calls, selected: () => selectedUID };
}

test('removing the selected measurement deselects it before the removal and forgets it after', async () => {
  const { steps, calls, selected } = removalSteps({ selected: 'm1' });
  assert.equal(await removeMeasurement('m1', steps), true);
  assert.deepEqual(calls, [['drop', 'm1'], ['select', null], ['remove', 'm1'], ['forget', 'm1']]);
  assert.equal(selected(), null);
});

test('removing another measurement keeps the selection', async () => {
  const { steps, calls, selected } = removalSteps({ selected: 'm2' });
  assert.equal(await removeMeasurement('m1', steps), true);
  assert.deepEqual(calls, [['drop', 'm1'], ['remove', 'm1'], ['forget', 'm1']]);
  assert.equal(selected(), 'm2');
});

test('a failed removal restores the selection only while Cornerstone still has the annotation', async () => {
  const kept = removalSteps({ selected: 'm1', removes: false, stillRegistered: true });
  assert.equal(await removeMeasurement('m1', kept.steps), false);
  assert.equal(kept.selected(), 'm1');
  assert.equal(kept.calls.some(([step]) => step === 'forget'), false);

  const gone = removalSteps({ selected: 'm1', removes: false, stillRegistered: false });
  assert.equal(await removeMeasurement('m1', gone.steps), false);
  assert.equal(gone.selected(), null);
});

test('a removal that throws resolves false and restores the selection the same way', async () => {
  const { steps, selected } = removalSteps({ selected: 'm1', removes: new Error('boom'), stillRegistered: true });
  assert.equal(await removeMeasurement('m1', steps), false);
  assert.equal(selected(), 'm1');
});

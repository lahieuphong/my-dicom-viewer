// Regression test: Image Slice Sync between two series in a split layout.
//
// The chest CT study has two 1.5 mm series that share one geometry. With pane
// A and pane B on different series, wheel scrolling pane A must move pane B to
// the same patient position only while Image Slice Sync is enabled.

import {
  MULTI_SERIES_STUDY_UID,
  PRIMARY_VIEWPORT_ID,
  SECONDARY_VIEWPORT_ID,
  delay,
  imageIndexExpression,
  imagePositionExpression,
  openSplitLayout,
  readOtherItemChecked,
  runOtherAction,
  runRegression,
  selectPaneSeries,
  seriesDescriptionExpression,
  wheelPane,
} from './lib/cdp-harness.mjs';

const SERIES_PAIR = ['Mediastinum 1.5', 'Lung 1.5'];
const WHEEL_STEPS = 12;
// Half of the 1.5 mm slice spacing: the synchronized slice is the same one.
const POSITION_TOLERANCE_MM = 0.75;

function distance(first, second) {
  if (!first || !second) return Number.POSITIVE_INFINITY;
  return Math.hypot(...first.map((value, index) => value - second[index]));
}

await runRegression(
  'test:viewer:slice-sync',
  async (page) => {
    await openSplitLayout(page);
    const primarySeries = await page.evaluate(
      seriesDescriptionExpression(PRIMARY_VIEWPORT_ID)
    );
    if (!SERIES_PAIR.includes(primarySeries)) {
      throw new Error(`Unexpected default series ${JSON.stringify(primarySeries)}.`);
    }
    const otherSeries = SERIES_PAIR.find((series) => series !== primarySeries);
    await selectPaneSeries(page, SECONDARY_VIEWPORT_ID, otherSeries);

    const readPanes = async () => ({
      primaryIndex: await page.evaluate(imageIndexExpression(PRIMARY_VIEWPORT_ID)),
      secondaryIndex: await page.evaluate(imageIndexExpression(SECONDARY_VIEWPORT_ID)),
      primaryPosition: await page.evaluate(imagePositionExpression(PRIMARY_VIEWPORT_ID)),
      secondaryPosition: await page.evaluate(imagePositionExpression(SECONDARY_VIEWPORT_ID)),
    });
    const failures = [];
    const steps = [];

    // Without sync, scrolling pane A leaves pane B alone.
    const unsyncedStart = await readPanes();
    await wheelPane(page, PRIMARY_VIEWPORT_ID, WHEEL_STEPS);
    await delay(500);
    const unsynced = await readPanes();
    steps.push({ step: 'scroll A without sync', ...unsynced });
    if (unsynced.primaryIndex === unsyncedStart.primaryIndex) {
      failures.push('wheel input did not scroll pane A');
    }
    if (unsynced.secondaryIndex !== unsyncedStart.secondaryIndex) {
      failures.push('pane B moved although Image Slice Sync was off');
    }

    await runOtherAction(page, 'imageSliceSync');
    const syncChecked = await readOtherItemChecked(page, 'imageSliceSync');
    if (syncChecked !== 'true') {
      failures.push(`Image Slice Sync item shows ${syncChecked} after enabling it`);
    }

    // With sync, pane B follows pane A to the same patient position.
    await wheelPane(page, PRIMARY_VIEWPORT_ID, WHEEL_STEPS);
    let synced = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      synced = await readPanes();
      if (
        distance(synced.primaryPosition, synced.secondaryPosition) <=
        POSITION_TOLERANCE_MM
      ) {
        break;
      }
      await delay(100);
    }
    steps.push({ step: 'scroll A with sync', ...synced });
    const syncedDistance = distance(synced.primaryPosition, synced.secondaryPosition);
    if (!(syncedDistance <= POSITION_TOLERANCE_MM)) {
      failures.push(
        `pane B did not follow pane A (positions ${syncedDistance.toFixed(2)} mm apart)`
      );
    }

    // Disabling sync detaches pane B again.
    await runOtherAction(page, 'imageSliceSync');
    const beforeDetached = await readPanes();
    await wheelPane(page, PRIMARY_VIEWPORT_ID, WHEEL_STEPS, -100);
    await delay(500);
    const detached = await readPanes();
    steps.push({ step: 'scroll A after disabling sync', ...detached });
    if (detached.primaryIndex === beforeDetached.primaryIndex) {
      failures.push('wheel input did not scroll pane A after disabling sync');
    }
    if (detached.secondaryIndex !== beforeDetached.secondaryIndex) {
      failures.push('pane B still followed pane A after disabling sync');
    }

    if (page.runtimeErrors.length > 0) {
      failures.push(`${page.runtimeErrors.length} runtime error(s)`);
    }
    const summary = {
      series: { primary: primarySeries, secondary: otherSeries },
      steps,
      runtimeErrors: page.runtimeErrors,
    };
    if (failures.length > 0) {
      throw new Error(`${failures.join('; ')}\n${JSON.stringify(summary, null, 2)}`);
    }
    return summary;
  },
  { studyUID: MULTI_SERIES_STUDY_UID }
);

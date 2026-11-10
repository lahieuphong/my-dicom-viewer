// Regression test: pane-scoped dialogs in a split layout.
//
// With pane A and pane B on different series, the DICOM Tag Browser must open
// on the active pane's series, and a user calibration drawn in pane B must
// calibrate pane B's image without touching the primary pane's series.

import {
  MULTI_SERIES_STUDY_UID,
  PRIMARY_VIEWPORT_ID,
  RENDERER_ID,
  SECONDARY_VIEWPORT_ID,
  activatePane,
  openSplitLayout,
  runOtherAction,
  runRegression,
  selectPaneSeries,
  seriesDescriptionExpression,
} from './lib/cdp-harness.mjs';

const SERIES_PAIR = ['Mediastinum 1.5', 'Lung 1.5'];
const ACTUAL_LENGTH_MM = 100;

function calibrationExpression(viewportId) {
  return `(() => {
    const viewport = window.__cornerstoneCore
      ?.getRenderingEngine?.('${RENDERER_ID}')
      ?.getViewport?.('${viewportId}');
    const imageId = viewport?.getCurrentImageId?.();
    return imageId
      ? window.__cornerstoneCore.utilities.calibratedPixelSpacingMetadataProvider
          .get('calibratedPixelSpacing', imageId) ?? null
      : null;
  })()`;
}

async function readTagBrowserSeries(page) {
  await runOtherAction(page, 'dicomTagBrowser');
  const select = `document.querySelector('[data-testid="dicom-tag-series-select"]')`;
  await page.waitFor(`Boolean(${select}?.textContent?.trim())`, 'DICOM Tag Browser series');
  const label = await page.evaluate(`${select}.textContent.trim()`);
  await page.cdp('Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  });
  await page.cdp('Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27,
  });
  await page.waitFor(
    `!document.querySelector('[data-testid="dicom-tag-browser-dialog"]') &&
      !document.querySelector('[role="dialog"]')`,
    'DICOM Tag Browser to close'
  );
  return label;
}

await runRegression(
  'test:viewer:pane-tools',
  async (page) => {
    await openSplitLayout(page);
    const primarySeries = await page.evaluate(
      seriesDescriptionExpression(PRIMARY_VIEWPORT_ID)
    );
    if (!SERIES_PAIR.includes(primarySeries)) {
      throw new Error(`Unexpected default series ${JSON.stringify(primarySeries)}.`);
    }
    const secondarySeries = SERIES_PAIR.find((series) => series !== primarySeries);
    await selectPaneSeries(page, SECONDARY_VIEWPORT_ID, secondarySeries);
    const failures = [];

    // DICOM Tag Browser follows the active pane.
    await activatePane(page, SECONDARY_VIEWPORT_ID);
    const tagSeriesForB = await readTagBrowserSeries(page);
    if (!tagSeriesForB.includes(secondarySeries)) {
      failures.push(`Tag Browser for pane B shows "${tagSeriesForB}"`);
    }
    await activatePane(page, PRIMARY_VIEWPORT_ID);
    const tagSeriesForA = await readTagBrowserSeries(page);
    if (!tagSeriesForA.includes(primarySeries)) {
      failures.push(`Tag Browser for pane A shows "${tagSeriesForA}"`);
    }

    // Calibration drawn in pane B calibrates pane B only.
    await activatePane(page, SECONDARY_VIEWPORT_ID);
    await runOtherAction(page, 'calibrationLine');
    const paneB = `document.querySelector(
      '[data-viewport-role="content"][data-viewport-uid="${SECONDARY_VIEWPORT_ID}"]'
    )`;
    await page.drag(
      await page.center(paneB, { x: 0.3, y: 0.5 }),
      await page.center(paneB, { x: 0.7, y: 0.5 })
    );
    await page.waitFor(
      `Boolean(document.querySelector('[data-testid="calibration-distance-input"]'))`,
      'calibration dialog'
    );
    await page.evaluate(`(() => {
      const input = document.querySelector('[data-testid="calibration-distance-input"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        .set.call(input, '${ACTUAL_LENGTH_MM}');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await page.click(
      await page.center(`document.querySelector('[data-testid="calibration-apply"]')`)
    );
    await page.waitFor(
      `!document.querySelector('[data-testid="calibration-dialog"]')`,
      'calibration dialog to close after applying',
      { timeoutMs: 15000 }
    );

    const calibrationB = await page.evaluate(calibrationExpression(SECONDARY_VIEWPORT_ID));
    const calibrationA = await page.evaluate(calibrationExpression(PRIMARY_VIEWPORT_ID));
    if (!calibrationB) failures.push('pane B image was not calibrated');
    if (calibrationA) failures.push('the primary pane image was calibrated as well');

    if (page.runtimeErrors.length > 0) {
      failures.push(`${page.runtimeErrors.length} runtime error(s)`);
    }
    const summary = {
      series: { primary: primarySeries, secondary: secondarySeries },
      tagBrowser: { paneB: tagSeriesForB, paneA: tagSeriesForA },
      calibration: { paneB: calibrationB, primary: calibrationA },
      runtimeErrors: page.runtimeErrors,
    };
    if (failures.length > 0) {
      throw new Error(`${failures.join('; ')}\n${JSON.stringify(summary, null, 2)}`);
    }
    return summary;
  },
  { studyUID: MULTI_SERIES_STUDY_UID }
);

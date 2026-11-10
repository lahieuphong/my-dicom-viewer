// Regression test: measurement navigation in a split viewport layout.
//
// A split layout opens every pane on the same series, so the referenced image
// alone cannot tell which pane a measurement belongs to. A measurement drawn
// in pane B must navigate pane B when its card is selected, and must leave the
// primary pane where the user put it.

import {
  PRIMARY_VIEWPORT_ID,
  RENDERER_ID,
  SECONDARY_VIEWPORT_ID,
  imageIndexExpression,
  openSplitLayout,
  paneStatesExpression,
  runRegression,
} from './lib/cdp-harness.mjs';

const PRIMARY_PARKED_INDEX = 10;
const SECONDARY_PARKED_INDEX = 20;
const CARD_SELECTOR = '[role="button"][data-annotation-uid]';
const secondaryElement = `document.querySelector(
  '[data-viewport-role="content"][data-viewport-uid="${SECONDARY_VIEWPORT_ID}"]'
)`;

async function selectLengthTool(page) {
  const item = '[role="menuitem"][data-tool-id="length"]';
  await page.click(
    await page.center(
      `document.querySelector('[data-testid="measurement-tools-menu-trigger"]')`
    )
  );
  await page.waitFor(`Boolean(document.querySelector('${item}'))`, 'Length menu item');
  await page.waitForMenuInteractive();
  await page.click(await page.center(`document.querySelector('${item}')`));
  await page.waitFor(`!document.querySelector('${item}')`, 'measurement menu to close');
}

async function parkViewport(page, viewportId, imageIndex) {
  await page.evaluate(`(async () => {
    const viewport = window.__cornerstoneCore
      ?.getRenderingEngine?.('${RENDERER_ID}')
      ?.getViewport?.('${viewportId}');
    await viewport.setImageIdIndex(${imageIndex});
  })()`);
  await page.waitFor(
    `${imageIndexExpression(viewportId)} === ${imageIndex}`,
    `${viewportId} to show image ${imageIndex}`
  );
}

await runRegression('test:viewer:measurement-navigation', async (page) => {
  const viewportIds = await openSplitLayout(page);
  const diagnostic = `({
    panes: ${paneStatesExpression(viewportIds)},
    cards: document.querySelectorAll('${CARD_SELECTOR}').length,
  })`;

  const drawnIndex = await page.evaluate(imageIndexExpression(SECONDARY_VIEWPORT_ID));
  await selectLengthTool(page);
  await page.drag(
    await page.center(secondaryElement, { x: 0.35, y: 0.4 }),
    await page.center(secondaryElement, { x: 0.62, y: 0.55 })
  );
  await page.waitFor(
    `document.querySelectorAll('${CARD_SELECTOR}').length === 1`,
    'the measurement drawn in pane B to be listed',
    { diagnostic }
  );

  await parkViewport(page, PRIMARY_VIEWPORT_ID, PRIMARY_PARKED_INDEX);
  await parkViewport(page, SECONDARY_VIEWPORT_ID, SECONDARY_PARKED_INDEX);

  await page.click(await page.center(`document.querySelector('${CARD_SELECTOR}')`));
  await page.waitFor(
    `${imageIndexExpression(SECONDARY_VIEWPORT_ID)} === ${drawnIndex}`,
    `pane B to navigate back to image ${drawnIndex}`,
    { timeoutMs: 10000, diagnostic }
  );

  const primaryIndex = await page.evaluate(imageIndexExpression(PRIMARY_VIEWPORT_ID));
  if (primaryIndex !== PRIMARY_PARKED_INDEX) {
    throw new Error(
      `Selecting a pane B measurement moved the primary pane to image ` +
        `${primaryIndex} (expected ${PRIMARY_PARKED_INDEX}).`
    );
  }
  if (page.runtimeErrors.length > 0) {
    throw new Error(
      `Runtime errors: ${JSON.stringify(page.runtimeErrors, null, 2)}`
    );
  }

  return {
    drawnInViewport: SECONDARY_VIEWPORT_ID,
    drawnImageIndex: drawnIndex,
    secondaryImageIndexAfterSelect: drawnIndex,
    primaryImageIndexAfterSelect: primaryIndex,
    runtimeErrors: page.runtimeErrors,
  };
});

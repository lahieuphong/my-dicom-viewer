// Regression test: measurement navigation in a split viewport layout.
//
// A split layout opens every pane on the same series, so the referenced image
// alone cannot tell which pane a measurement belongs to. A measurement drawn
// in pane B must navigate pane B when its card is selected, and must leave the
// primary pane where the user put it.
//
// A measurement drawn in the primary pane must bring the primary pane back to
// its image by changing the image only (no new stack, no other image shown),
// and must be selected and drawn there, also when the image is already shown.

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
const PRIMARY_AWAY_INDEX = 25;
const CARD_SELECTOR = '[role="button"][data-annotation-uid]';
const paneElement = (viewportId) => `document.querySelector(
  '[data-viewport-role="content"][data-viewport-uid="${viewportId}"]'
)`;
const secondaryElement = paneElement(SECONDARY_VIEWPORT_ID);
const primaryElement = paneElement(PRIMARY_VIEWPORT_ID);
const cardWithUID = (uid) =>
  `document.querySelector('${CARD_SELECTOR}[data-annotation-uid=${JSON.stringify(uid)}]')`;
const cardUIDs = `[...document.querySelectorAll('${CARD_SELECTOR}')].map(
  (card) => card.getAttribute('data-annotation-uid')
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

  // A measurement drawn in the primary pane, on the stack it shows.
  const [secondaryUID] = await page.evaluate(cardUIDs);
  await page.drag(
    await page.center(primaryElement, { x: 0.3, y: 0.62 }),
    await page.center(primaryElement, { x: 0.55, y: 0.76 })
  );
  await page.waitFor(
    `${cardUIDs}.length === 2`,
    'the measurement drawn in the primary pane to be listed',
    { diagnostic }
  );
  const primaryUID = (await page.evaluate(cardUIDs)).find((uid) => uid !== secondaryUID);
  await parkViewport(page, PRIMARY_VIEWPORT_ID, PRIMARY_AWAY_INDEX);
  const secondaryIndexBefore = await page.evaluate(imageIndexExpression(SECONDARY_VIEWPORT_ID));

  // Record every stack the primary pane is given and every image it shows.
  await page.evaluate(`(() => {
    const viewport = window.__cornerstoneCore
      ?.getRenderingEngine?.('${RENDERER_ID}')
      ?.getViewport?.('${PRIMARY_VIEWPORT_ID}');
    window.__primaryNavigation = { setStacks: 0, shown: [] };
    const original = viewport.setStack;
    viewport.setStack = function (...args) {
      window.__primaryNavigation.setStacks += 1;
      return original.apply(this, args);
    };
    viewport.element.addEventListener('CORNERSTONE_STACK_NEW_IMAGE', (event) => {
      window.__primaryNavigation.shown.push(event.detail?.imageIdIndex ?? null);
    });
    return true;
  })()`);

  const primarySelectedAndDrawn = `(() => {
    const card = ${cardWithUID(primaryUID)};
    const drawn = [...document.querySelectorAll(
      '#svg-layer-${PRIMARY_VIEWPORT_ID} [data-annotation-uid]'
    )].some((node) => node.getAttribute('data-annotation-uid') === ${JSON.stringify(primaryUID)});
    return ${imageIndexExpression(PRIMARY_VIEWPORT_ID)} === ${PRIMARY_PARKED_INDEX} &&
      card?.getAttribute('aria-pressed') === 'true' &&
      drawn;
  })()`;
  const primaryDiagnostic = `({
    panes: ${paneStatesExpression(viewportIds)},
    pressed: [...document.querySelectorAll('${CARD_SELECTOR}[aria-pressed="true"]')]
      .map((card) => card.getAttribute('data-annotation-uid')),
    recorded: window.__primaryNavigation,
  })`;

  await page.click(await page.center(cardWithUID(primaryUID)));
  await page.waitFor(
    primarySelectedAndDrawn,
    `the primary pane to return to image ${PRIMARY_PARKED_INDEX} with its measurement selected`,
    { timeoutMs: 10000, diagnostic: primaryDiagnostic }
  );

  // Again with the image already shown: select pane B's card, then this one.
  await page.click(await page.center(cardWithUID(secondaryUID)));
  await page.waitFor(
    `${cardWithUID(secondaryUID)}?.getAttribute('aria-pressed') === 'true'`,
    "pane B's measurement to be selected",
    { timeoutMs: 10000, diagnostic: primaryDiagnostic }
  );
  await page.click(await page.center(cardWithUID(primaryUID)));
  await page.waitFor(
    primarySelectedAndDrawn,
    'the shown measurement to be selected again',
    { timeoutMs: 10000, diagnostic: primaryDiagnostic }
  );

  const recorded = await page.evaluate('window.__primaryNavigation');
  if (recorded.setStacks !== 0) {
    throw new Error(
      `Selecting a measurement on the shown stack set ${recorded.setStacks} new stack(s).`
    );
  }
  if (recorded.shown.some((index) => index !== PRIMARY_PARKED_INDEX)) {
    throw new Error(
      `The primary pane showed images ${JSON.stringify(recorded.shown)} on its way ` +
        `to image ${PRIMARY_PARKED_INDEX}.`
    );
  }
  const secondaryIndexAfter = await page.evaluate(imageIndexExpression(SECONDARY_VIEWPORT_ID));
  if (secondaryIndexAfter !== secondaryIndexBefore) {
    throw new Error(
      `Selecting a primary-pane measurement moved pane B from image ` +
        `${secondaryIndexBefore} to ${secondaryIndexAfter}.`
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
    primaryMeasurement: { drawnImageIndex: PRIMARY_PARKED_INDEX, recorded },
    runtimeErrors: page.runtimeErrors,
  };
});

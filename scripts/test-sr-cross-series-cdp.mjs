// Regression test: viewing an SR whose measurement is on another series.
//
// With the primary pane on series B, viewing an SR measured on series A must
// switch the pane to series A and open it at the measured image directly:
// a single setStack that starts there, no image of series A shown before it,
// and the SR's measurement listed, selected and drawn.

import {
  MULTI_SERIES_STUDY_UID,
  PRIMARY_VIEWPORT_ID,
  RENDERER_ID,
  imageIndexExpression,
  paneStatesExpression,
  runRegression,
  seriesDescriptionExpression,
  waitForPrimaryViewport,
} from './lib/cdp-harness.mjs';

const MEASURED_SERIES = 'Lung 1.5';
const OTHER_SERIES = 'Mediastinum 1.5';
const MEASURED_INDEX = 15;
const REPORT_NAME = 'Cross-series SR';
const CARD_SELECTOR = '[role="button"][data-annotation-uid]';
const primaryElement = `document.querySelector(
  '[data-viewport-role="content"][data-viewport-uid="${PRIMARY_VIEWPORT_ID}"]'
)`;
const viewportExpression = `window.__cornerstoneCore
  ?.getRenderingEngine?.('${RENDERER_ID}')
  ?.getViewport?.('${PRIMARY_VIEWPORT_ID}')`;
const buttonWithText = (text) => `[...document.querySelectorAll('button')].find(
  (button) => button.textContent?.trim() === ${JSON.stringify(text)}
)`;
const closeSrButton = `[...document.querySelectorAll('button')].find(
  (button) => button.title === 'Close SR'
)`;
const viewSrButton = `document.querySelector(
  'button[aria-label=${JSON.stringify(`View SR ${REPORT_NAME}`)}]'
)`;

function sidebarButton(description) {
  return `[...document.querySelectorAll('button[aria-pressed]')].find((button) =>
    button.offsetParent !== null &&
    button.getAttribute('aria-label')?.endsWith(${JSON.stringify(` - ${description}`)})
  )`;
}

const primaryShows = (description, index) => `(() => {
  const [primary] = ${paneStatesExpression([PRIMARY_VIEWPORT_ID])};
  return ${seriesDescriptionExpression(PRIMARY_VIEWPORT_ID)} === ${JSON.stringify(description)} &&
    ${imageIndexExpression(PRIMARY_VIEWPORT_ID)} === ${index} &&
    Boolean(primary?.displayed);
})()`;

async function showSeries(page, description) {
  await page.click(await page.center(sidebarButton(description)));
  await page.waitFor(primaryShows(description, 0), `the primary pane to show ${description}`, {
    timeoutMs: 60000,
  });
}

await runRegression('test:viewer:sr-cross-series', async (page) => {
  await waitForPrimaryViewport(page);
  await showSeries(page, MEASURED_SERIES);

  await page.evaluate(`${viewportExpression}.setImageIdIndex(${MEASURED_INDEX})`);
  await page.waitFor(
    primaryShows(MEASURED_SERIES, MEASURED_INDEX),
    `image ${MEASURED_INDEX} of ${MEASURED_SERIES}`
  );

  const lengthItem = '[role="menuitem"][data-tool-id="length"]';
  await page.click(
    await page.center(`document.querySelector('[data-testid="measurement-tools-menu-trigger"]')`)
  );
  await page.waitFor(`Boolean(document.querySelector('${lengthItem}'))`, 'Length menu item');
  await page.waitForMenuInteractive();
  await page.click(await page.center(`document.querySelector('${lengthItem}')`));
  await page.waitFor(`!document.querySelector('${lengthItem}')`, 'measurement menu to close');
  await page.drag(
    await page.center(primaryElement, { x: 0.38, y: 0.42 }),
    await page.center(primaryElement, { x: 0.6, y: 0.56 })
  );
  await page.waitFor(
    `document.querySelectorAll('${CARD_SELECTOR}').length === 1`,
    'the measurement to be listed'
  );

  await page.click(await page.center(buttonWithText('Create SR')));
  await page.waitFor(`Boolean(document.querySelector('input[aria-label="Tên SR"]'))`, 'SR name input');
  await page.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Tên SR"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setValue.call(input, ${JSON.stringify(REPORT_NAME)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await page.click(await page.center(buttonWithText('Tạo SR')));
  await page.waitFor(`Boolean(${viewSrButton})`, 'the SR to be listed', { timeoutMs: 60000 });
  // The name dialog's overlay swallows clicks while it animates closed.
  await page.waitFor(`!document.querySelector('[role="dialog"]')`, 'the SR dialog to close');

  await showSeries(page, OTHER_SERIES);

  // Record every stack the primary viewport is given and every image it shows.
  await page.evaluate(`(() => {
    const viewport = ${viewportExpression};
    window.__crossSeries = { setStacks: [], shown: [] };
    const original = viewport.setStack;
    viewport.setStack = function (imageIds, index, ...rest) {
      window.__crossSeries.setStacks.push({ images: imageIds?.length ?? 0, index: index ?? 0 });
      return original.call(this, imageIds, index, ...rest);
    };
    viewport.element.addEventListener('CORNERSTONE_STACK_NEW_IMAGE', (event) => {
      window.__crossSeries.shown.push(event.detail?.imageIdIndex ?? null);
    });
    return true;
  })()`);

  await page.click(await page.center(viewSrButton));
  await page.waitFor(
    `${primaryShows(MEASURED_SERIES, MEASURED_INDEX)} &&
      Boolean(${closeSrButton})`,
    `the SR to open ${MEASURED_SERIES} at image ${MEASURED_INDEX}`,
    {
      timeoutMs: 60000,
      diagnostic: `({
        series: ${seriesDescriptionExpression(PRIMARY_VIEWPORT_ID)},
        index: ${imageIndexExpression(PRIMARY_VIEWPORT_ID)},
        recorded: window.__crossSeries,
      })`,
    }
  );
  await page.waitFor(
    `(() => {
      const cards = [...document.querySelectorAll('${CARD_SELECTOR}')];
      const svgUIDs = new Set([...document.querySelectorAll(
        '#svg-layer-${PRIMARY_VIEWPORT_ID} [data-annotation-uid]'
      )].map((node) => node.getAttribute('data-annotation-uid')));
      return cards.length === 1 &&
        cards[0].getAttribute('aria-pressed') === 'true' &&
        svgUIDs.has(cards[0].getAttribute('data-annotation-uid'));
    })()`,
    'the SR measurement to be selected and drawn'
  );

  const recorded = await page.evaluate('window.__crossSeries');
  if (
    recorded.setStacks.length !== 1 ||
    recorded.setStacks[0].index !== MEASURED_INDEX
  ) {
    throw new Error(
      `Expected one setStack opening image ${MEASURED_INDEX}, got ${JSON.stringify(recorded.setStacks)}.`
    );
  }
  if (recorded.shown.some((index) => index !== MEASURED_INDEX)) {
    throw new Error(
      `The primary pane showed images ${JSON.stringify(recorded.shown)} before or after ` +
        `image ${MEASURED_INDEX}.`
    );
  }
  if (page.runtimeErrors.length > 0) {
    throw new Error(`Runtime errors: ${JSON.stringify(page.runtimeErrors, null, 2)}`);
  }

  return {
    measuredSeries: MEASURED_SERIES,
    measuredIndex: MEASURED_INDEX,
    switchedFrom: OTHER_SERIES,
    recorded,
    runtimeErrors: page.runtimeErrors,
  };
}, { studyUID: MULTI_SERIES_STUDY_UID });

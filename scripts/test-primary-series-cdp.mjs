// Regression test: switching the primary pane's series from the sidebar.
//
// Each switch must end on the selected series at its first image with the
// loading overlay gone and an untouched view (no rotation, flip or invert,
// fitted), rapid successive switches must settle on the last selection, and
// useRenderingEngine must be the only one loading the stack: one setStack per
// switch.

import {
  MULTI_SERIES_STUDY_UID,
  PRIMARY_VIEWPORT_ID,
  RENDERER_ID,
  delay,
  imageIndexExpression,
  runOtherAction,
  runRegression,
  seriesDescriptionExpression,
  waitForPrimaryViewport,
} from './lib/cdp-harness.mjs';

const SERIES_PAIR = ['Lung 1.5', 'Mediastinum 1.5'];

const primaryStateExpression = `(() => {
  const viewport = window.__cornerstoneCore
    ?.getRenderingEngine?.('${RENDERER_ID}')
    ?.getViewport?.('${PRIMARY_VIEWPORT_ID}');
  const pane = document.querySelector('[data-viewport-pane="${PRIMARY_VIEWPORT_ID}"]');
  const scrollbar = pane?.querySelector('[role="scrollbar"]');
  return {
    series: ${seriesDescriptionExpression(PRIMARY_VIEWPORT_ID)},
    index: ${imageIndexExpression(PRIMARY_VIEWPORT_ID)},
    imageCount: viewport?.getImageIds?.()?.length ?? 0,
    status: String(viewport?.viewportStatus ?? '').toLowerCase(),
    loadingOverlay: [...(pane?.querySelectorAll('span.sr-only') ?? [])].some((node) =>
      /Đang nạp hình|Hoàn tất/.test(node.textContent ?? '')
    ),
    frame: scrollbar?.getAttribute('aria-valuenow') ?? null,
    frames: scrollbar?.getAttribute('aria-valuemax') ?? null,
  };
})()`;

const primaryViewExpression = `(() => {
  const viewport = window.__cornerstoneCore
    .getRenderingEngine('${RENDERER_ID}')
    .getViewport('${PRIMARY_VIEWPORT_ID}');
  const camera = viewport.getCamera();
  viewport.resetCamera({ resetPan: true, resetZoom: true, resetToCenter: true });
  const fitted = viewport.getCamera().parallelScale;
  viewport.setCamera(camera);
  return {
    rotation: viewport.getViewPresentation().rotation ?? 0,
    flipHorizontal: Boolean(camera.flipHorizontal),
    invert: Boolean(viewport.getProperties().invert),
    fitted: Math.abs(camera.parallelScale - fitted) / fitted <= 0.01,
  };
})()`;

// Counts StackViewport.setStack calls on the primary viewport instance.
const installSetStackProbeExpression = `(() => {
  const viewport = window.__cornerstoneCore
    .getRenderingEngine('${RENDERER_ID}')
    .getViewport('${PRIMARY_VIEWPORT_ID}');
  window.__setStackCalls = 0;
  if (!viewport.__setStackProbe) {
    const original = viewport.setStack;
    viewport.setStack = function (...args) {
      window.__setStackCalls += 1;
      return original.apply(this, args);
    };
    viewport.__setStackProbe = true;
  }
  return true;
})()`;

function sidebarButton(description) {
  return `[...document.querySelectorAll('button[aria-pressed]')].find((button) =>
    button.offsetParent !== null &&
    button.getAttribute('aria-label')?.endsWith(${JSON.stringify(` - ${description}`)})
  )`;
}

async function waitForPrimarySeries(page, description, label) {
  await page.waitFor(
    `(() => {
      const state = ${primaryStateExpression};
      return state.series === ${JSON.stringify(description)} &&
        state.status === 'rendered' && state.index === 0 &&
        !state.loadingOverlay && state.frame === '1' &&
        Number(state.frames) === state.imageCount;
    })()`,
    label,
    { timeoutMs: 30000, diagnostic: primaryStateExpression }
  );
  // Let late attach work (render checks, settle timers) finish as well.
  await delay(1500);
  return page.evaluate(primaryStateExpression);
}

await runRegression(
  'test:viewer:primary-series',
  async (page) => {
    await waitForPrimaryViewport(page);
    const initial = await page.evaluate(primaryStateExpression);
    if (!SERIES_PAIR.includes(initial.series)) {
      throw new Error(`Unexpected default series ${JSON.stringify(initial.series)}.`);
    }
    const [first, second] =
      initial.series === SERIES_PAIR[0] ? SERIES_PAIR : [...SERIES_PAIR].reverse();
    await page.evaluate(installSetStackProbeExpression);

    const failures = [];
    const steps = [];
    const switchTo = async (description) => {
      await page.evaluate('window.__setStackCalls = 0');
      await page.click(await page.center(sidebarButton(description)));
      const state = await waitForPrimarySeries(page, description, `primary pane on ${description}`);
      const setStackCalls = await page.evaluate('window.__setStackCalls');
      steps.push({ switchTo: description, setStackCalls, ...state });
      if (state.series !== description || state.loadingOverlay) {
        failures.push(`after switching to ${description}: ${JSON.stringify(state)}`);
      }
      return setStackCalls;
    };

    // A changed view on one series must not carry over to the next one.
    for (const action of ['rotate90', 'flipHorizontal', 'invert']) {
      await runOtherAction(page, action);
    }
    const viewBeforeSwitch = await page.evaluate(primaryViewExpression);
    if (viewBeforeSwitch.rotation === 0 || !viewBeforeSwitch.invert) {
      failures.push(`toolbar actions did not change the view: ${JSON.stringify(viewBeforeSwitch)}`);
    }
    const callsSecond = await switchTo(second);
    const viewAfterSwitch = await page.evaluate(primaryViewExpression);
    steps.push({ viewBeforeSwitch, viewAfterSwitch });
    const untouched = { rotation: 0, flipHorizontal: false, invert: false, fitted: true };
    for (const [key, value] of Object.entries(untouched)) {
      if (viewAfterSwitch[key] !== value) {
        failures.push(`after switching series, ${key} is ${viewAfterSwitch[key]}`);
      }
    }

    const callsFirst = await switchTo(first);

    // Rapid switches: only the last selection may win.
    await page.evaluate('window.__setStackCalls = 0');
    for (const description of [second, first, second]) {
      await page.click(await page.center(sidebarButton(description)));
      await delay(30);
    }
    const rapid = await waitForPrimarySeries(page, second, 'primary pane after rapid switches');
    steps.push({ rapidSwitchesEndOn: second, ...rapid });

    for (const [series, calls] of [[second, callsSecond], [first, callsFirst]]) {
      if (calls !== 1) failures.push(`switching to ${series} called setStack ${calls}x`);
    }
    if (page.runtimeErrors.length > 0) {
      failures.push(`${page.runtimeErrors.length} runtime error(s)`);
    }
    const summary = { steps, runtimeErrors: page.runtimeErrors };
    if (failures.length > 0) {
      throw new Error(`${failures.join('; ')}\n${JSON.stringify(summary, null, 2)}`);
    }
    return summary;
  },
  { studyUID: MULTI_SERIES_STUDY_UID }
);

// Regression test: toolbar view actions in a split viewport layout.
//
// Rotate, Flip, Invert and Reset must apply to the active pane only, and
// Reset must return that pane to a fitted, unrotated, unflipped, uninverted
// view, for the primary pane as well as for a secondary pane.

import {
  PRIMARY_VIEWPORT_ID,
  RENDERER_ID,
  SECONDARY_VIEWPORT_ID,
  activatePane,
  openSplitLayout,
  readOtherItemChecked,
  runOtherAction,
  runRegression,
} from './lib/cdp-harness.mjs';

const FIT_TOLERANCE = 0.01;

const viewStatesExpression = `(() => {
  const engine = window.__cornerstoneCore?.getRenderingEngine?.('${RENDERER_ID}');
  return Object.fromEntries(${JSON.stringify([
    PRIMARY_VIEWPORT_ID,
    SECONDARY_VIEWPORT_ID,
  ])}.map((viewportId) => {
    const viewport = engine.getViewport(viewportId);
    const camera = viewport.getCamera();
    viewport.resetCamera({ resetPan: true, resetZoom: true, resetToCenter: true });
    const fitted = viewport.getCamera().parallelScale;
    viewport.setCamera(camera);
    return [viewportId, {
      rotation: viewport.getViewPresentation().rotation ?? 0,
      flipHorizontal: Boolean(viewport.getCamera().flipHorizontal),
      invert: Boolean(viewport.getProperties().invert),
      fitted:
        Math.abs(camera.parallelScale - fitted) / fitted <= ${FIT_TOLERANCE},
    }];
  }));
})()`;

function describeView(view) {
  return JSON.stringify(view);
}

await runRegression('test:viewer:toolbar-actions', async (page) => {
  await openSplitLayout(page);
  const failures = [];
  const steps = [];

  const expectViews = async (label, expected) => {
    let views = null;
    const startedAt = Date.now();
    // Rendering is asynchronous; poll briefly for the expected state.
    while (Date.now() - startedAt < 5000) {
      views = await page.evaluate(viewStatesExpression);
      const matches = Object.entries(expected).every(([viewportId, view]) =>
        Object.entries(view).every(([key, value]) => views[viewportId][key] === value)
      );
      if (matches) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const [viewportId, view] of Object.entries(expected)) {
      for (const [key, value] of Object.entries(view)) {
        if (views[viewportId][key] !== value) {
          failures.push(
            `${label}: ${viewportId}.${key} is ${views[viewportId][key]}, expected ${value}`
          );
        }
      }
    }
    steps.push({ label, views });
  };

  const untouched = { rotation: 0, flipHorizontal: false, invert: false, fitted: true };
  await expectViews('initial', {
    [PRIMARY_VIEWPORT_ID]: untouched,
    [SECONDARY_VIEWPORT_ID]: untouched,
  });

  await activatePane(page, SECONDARY_VIEWPORT_ID);
  await runOtherAction(page, 'rotate90');
  await expectViews('pane B rotate', {
    [PRIMARY_VIEWPORT_ID]: untouched,
    [SECONDARY_VIEWPORT_ID]: { rotation: 90 },
  });
  await runOtherAction(page, 'flipHorizontal');
  await expectViews('pane B flip', {
    [PRIMARY_VIEWPORT_ID]: untouched,
    [SECONDARY_VIEWPORT_ID]: { flipHorizontal: true },
  });
  await runOtherAction(page, 'invert');
  await expectViews('pane B invert', {
    [PRIMARY_VIEWPORT_ID]: untouched,
    [SECONDARY_VIEWPORT_ID]: { invert: true },
  });
  const invertChecked = await readOtherItemChecked(page, 'invert');
  if (invertChecked !== 'true') {
    failures.push(`Invert menu item shows ${invertChecked} for inverted pane B`);
  }

  await runOtherAction(page, 'reset');
  await expectViews('pane B reset', {
    [PRIMARY_VIEWPORT_ID]: untouched,
    [SECONDARY_VIEWPORT_ID]: untouched,
  });

  await activatePane(page, PRIMARY_VIEWPORT_ID);
  await runOtherAction(page, 'rotate90');
  await runOtherAction(page, 'invert');
  await expectViews('primary rotate + invert', {
    [PRIMARY_VIEWPORT_ID]: { rotation: 90, invert: true },
    [SECONDARY_VIEWPORT_ID]: untouched,
  });
  await runOtherAction(page, 'reset');
  await expectViews('primary reset', {
    [PRIMARY_VIEWPORT_ID]: untouched,
    [SECONDARY_VIEWPORT_ID]: untouched,
  });

  if (page.runtimeErrors.length > 0) {
    failures.push(`${page.runtimeErrors.length} runtime error(s)`);
  }
  const summary = {
    steps: steps.map(({ label, views }) => ({
      label,
      primary: describeView(views[PRIMARY_VIEWPORT_ID]),
      secondary: describeView(views[SECONDARY_VIEWPORT_ID]),
    })),
    runtimeErrors: page.runtimeErrors,
  };
  if (failures.length > 0) {
    throw new Error(`${failures.join('; ')}\n${JSON.stringify(summary, null, 2)}`);
  }
  return summary;
});

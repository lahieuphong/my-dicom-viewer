// Regression test: dragging a side panel in a split viewport layout.
//
// Cornerstone clears a canvas whenever RenderingEngine.resize() changes its
// backing buffer and only redraws on the next animation frame. The viewer must
// therefore never resize buffers while a panel is being dragged (panes stay
// CSS-scaled), then settle once: every canvas matches its cell, no resize
// snapshot is left behind, and every pane keeps the frame it was showing.

import {
  RENDERER_ID,
  delay,
  openSplitLayout,
  paneStatesExpression,
  panesReadyExpression,
  runRegression,
  waitForResizeSnapshotsReleased,
} from './lib/cdp-harness.mjs';

const DRAG_DISTANCE_PX = 120;
const DRAG_STEPS = 12;
const CAMERA_TOLERANCE = 0.03;

// Counts engine.resize() calls, split by whether a panel drag is active.
const installResizeProbeExpression = `(() => {
  const engine = window.__cornerstoneCore?.getRenderingEngine?.('${RENDERER_ID}');
  if (!engine) return false;
  window.__viewerResizeProbe = { duringDrag: 0, total: 0 };
  if (!engine.__viewerResizeProbeInstalled) {
    const originalResize = engine.resize.bind(engine);
    engine.resize = (...args) => {
      const probe = window.__viewerResizeProbe;
      if (probe) {
        probe.total += 1;
        const grid = document.querySelector('.viewer-workspace-grid');
        if (grid?.dataset.panelResizing === 'true') probe.duringDrag += 1;
      }
      return originalResize(...args);
    };
    engine.__viewerResizeProbeInstalled = true;
  }
  return true;
})()`;

function expectedVisibleFrameScale(before, after) {
  const widthRatio = after.clientWidth / before.clientWidth;
  const heightRatio = after.clientHeight / before.clientHeight;
  return (before.parallelScale * heightRatio) / Math.min(widthRatio, heightRatio);
}

await runRegression('test:viewer:resize', async (page) => {
  const viewportIds = await openSplitLayout(page);
  const panes = paneStatesExpression(viewportIds);
  const before = await page.evaluate(panes);

  if (!(await page.evaluate(installResizeProbeExpression))) {
    throw new Error('Could not instrument RenderingEngine.resize().');
  }

  const handle = await page.center(
    `document.querySelector('.viewer-panel-resize-handle-left')`
  );
  await page.mouse('mouseMoved', handle, 0);
  await page.mouse('mousePressed', handle, 1);
  for (let step = 1; step <= DRAG_STEPS; step += 1) {
    await page.mouse(
      'mouseMoved',
      { x: handle.x + (DRAG_DISTANCE_PX * step) / DRAG_STEPS, y: handle.y },
      1
    );
    await delay(24);
  }
  // Hold the pointer: ResizeObservers and settle timers get time to fire.
  await delay(400);
  const midDrag = await page.evaluate(`({
    probe: { ...window.__viewerResizeProbe },
    panelResizing:
      document.querySelector('.viewer-workspace-grid')?.dataset.panelResizing ?? null,
  })`);
  await page.mouse(
    'mouseReleased',
    { x: handle.x + DRAG_DISTANCE_PX, y: handle.y },
    0
  );

  await delay(900);
  await page.waitFor(panesReadyExpression(viewportIds), 'panes to settle after the drag', {
    diagnostic: panes,
  });
  const after = await page.evaluate(panes);
  const afterDrag = {
    probe: await page.evaluate('({ ...window.__viewerResizeProbe })'),
    leftoverSnapshots: await waitForResizeSnapshotsReleased(page),
  };

  const failures = [];
  if (midDrag.panelResizing !== 'true') {
    failures.push(`panel drag did not start (${midDrag.panelResizing})`);
  }
  if (midDrag.probe.duringDrag !== 0) {
    failures.push(
      `RenderingEngine.resize() ran ${midDrag.probe.duringDrag}x while dragging`
    );
  }
  if (afterDrag.probe.total === 0) {
    failures.push('RenderingEngine.resize() never ran after the drag');
  }
  if (afterDrag.leftoverSnapshots !== 0) {
    failures.push(`${afterDrag.leftoverSnapshots} resize snapshot(s) left`);
  }

  const cameras = before.map((paneBefore, index) => {
    const paneAfter = after[index];
    const expected = expectedVisibleFrameScale(paneBefore, paneAfter);
    const relativeError =
      Math.abs(paneAfter.parallelScale - expected) / expected;
    if (paneAfter.clientWidth === paneBefore.clientWidth) {
      failures.push(`${paneBefore.viewportId} did not change size`);
    }
    if (!(relativeError <= CAMERA_TOLERANCE)) {
      failures.push(
        `${paneBefore.viewportId} lost its visible frame: parallelScale ` +
          `${paneAfter.parallelScale} vs expected ${expected}`
      );
    }
    return {
      viewportId: paneBefore.viewportId,
      sizeBefore: [paneBefore.clientWidth, paneBefore.clientHeight],
      sizeAfter: [paneAfter.clientWidth, paneAfter.clientHeight],
      parallelScaleBefore: paneBefore.parallelScale,
      parallelScaleAfter: paneAfter.parallelScale,
      expectedParallelScale: expected,
      relativeError,
    };
  });

  if (page.runtimeErrors.length > 0) {
    failures.push(`${page.runtimeErrors.length} runtime error(s)`);
  }

  const summary = {
    resizeCallsWhileDragging: midDrag.probe.duringDrag,
    resizeCallsTotal: afterDrag.probe.total,
    leftoverSnapshots: afterDrag.leftoverSnapshots,
    cameras,
    runtimeErrors: page.runtimeErrors,
  };
  if (failures.length > 0) {
    throw new Error(`${failures.join('; ')}\n${JSON.stringify(summary, null, 2)}`);
  }
  return summary;
});

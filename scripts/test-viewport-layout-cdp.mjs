// Regression test: switching the viewport grid layout.
//
// RenderingEngine.resize() clears every canvas and Cornerstone redraws on the
// next animation frame. A resize that runs inside a requestAnimationFrame
// callback therefore lets the browser paint cleared canvases for one frame,
// unless a resize snapshot covers them. Every layout change must also leave
// untouched panes fitted to their new cells.

import {
  RENDERER_ID,
  applyLayoutPreset,
  runRegression,
  waitForPrimaryViewport,
  waitForResizeSnapshotsReleased,
} from './lib/cdp-harness.mjs';

const FIT_TOLERANCE = 0.01;

// Tracks rAF callbacks and counts content canvases with an image that a resize
// inside one of them clears without a snapshot above them.
const installPaintProbeExpression = `(() => {
  const engine = window.__cornerstoneCore?.getRenderingEngine?.('${RENDERER_ID}');
  if (!engine) return false;
  window.__viewerPaintProbe = { resizes: 0, resizesInFrame: 0, unprotectedClears: 0 };

  if (!window.__viewerRafProbeInstalled) {
    const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    window.__viewerInAnimationFrame = 0;
    window.requestAnimationFrame = (callback) =>
      originalRequestAnimationFrame((time) => {
        window.__viewerInAnimationFrame += 1;
        try {
          return callback(time);
        } finally {
          window.__viewerInAnimationFrame -= 1;
        }
      });
    window.__viewerRafProbeInstalled = true;
  }

  if (!engine.__viewerPaintProbeInstalled) {
    const originalResize = engine.resize.bind(engine);
    engine.resize = (...args) => {
      const probe = window.__viewerPaintProbe;
      if (probe) {
        probe.resizes += 1;
        if (window.__viewerInAnimationFrame > 0) {
          probe.resizesInFrame += 1;
          for (const viewport of engine.getViewports()) {
            const element = viewport?.element;
            if (element?.dataset?.viewportRole !== 'content') continue;
            let hasImage = false;
            try { hasImage = Boolean(viewport.getCurrentImageId?.()); } catch {}
            const canvas = element.querySelector('canvas.cornerstone-canvas');
            if (!hasImage || !canvas || canvas.clientWidth === 0) continue;
            const covered = Boolean(
              canvas.parentElement?.querySelector('[data-viewer-resize-snapshot="true"]')
            );
            if (!covered) probe.unprotectedClears += 1;
          }
        }
      }
      return originalResize(...args);
    };
    engine.__viewerPaintProbeInstalled = true;
  }
  return true;
})()`;

// For every pane: does its camera equal the camera resetCamera() would fit?
function fitStateExpression(viewportIds) {
  return `(() => {
    const engine = window.__cornerstoneCore?.getRenderingEngine?.('${RENDERER_ID}');
    return ${JSON.stringify(viewportIds)}.map((viewportId) => {
      const viewport = engine?.getViewport?.(viewportId);
      if (!viewport) return { viewportId, missing: true };
      const camera = viewport.getCamera();
      viewport.resetCamera({ resetPan: true, resetZoom: true, resetToCenter: true });
      const fitted = viewport.getCamera();
      viewport.setCamera(camera);
      return {
        viewportId,
        parallelScale: camera.parallelScale,
        fittedParallelScale: fitted.parallelScale,
      };
    });
  })()`;
}

await runRegression('test:viewer:layout', async (page) => {
  await waitForPrimaryViewport(page);
  if (!(await page.evaluate(installPaintProbeExpression))) {
    throw new Error('Could not instrument RenderingEngine.resize().');
  }

  const failures = [];
  const steps = [];
  for (const [rows, columns] of [[1, 2], [2, 2], [1, 1]]) {
    await page.evaluate(
      `Object.assign(window.__viewerPaintProbe, { resizes: 0, resizesInFrame: 0, unprotectedClears: 0 })`
    );
    const viewportIds = await applyLayoutPreset(page, rows, columns);
    const probe = await page.evaluate('({ ...window.__viewerPaintProbe })');
    const fit = await page.evaluate(fitStateExpression(viewportIds));
    const leftoverSnapshots = await waitForResizeSnapshotsReleased(page);
    const layout = `${rows}x${columns}`;

    if (probe.unprotectedClears !== 0) {
      failures.push(
        `${layout}: ${probe.unprotectedClears} canvas(es) cleared inside an ` +
          `animation frame without a snapshot`
      );
    }
    if (leftoverSnapshots !== 0) {
      failures.push(`${layout}: ${leftoverSnapshots} resize snapshot(s) left`);
    }
    for (const pane of fit) {
      const error =
        Math.abs(pane.parallelScale - pane.fittedParallelScale) /
        pane.fittedParallelScale;
      if (pane.missing || !(error <= FIT_TOLERANCE)) {
        failures.push(
          `${layout}: ${pane.viewportId} is not fitted to its cell ` +
            `(${pane.parallelScale} vs ${pane.fittedParallelScale})`
        );
      }
    }
    steps.push({ layout, probe, leftoverSnapshots, fit });
  }

  if (page.runtimeErrors.length > 0) {
    failures.push(`${page.runtimeErrors.length} runtime error(s)`);
  }
  const summary = { steps, runtimeErrors: page.runtimeErrors };
  if (failures.length > 0) {
    throw new Error(`${failures.join('; ')}\n${JSON.stringify(summary, null, 2)}`);
  }
  return summary;
});

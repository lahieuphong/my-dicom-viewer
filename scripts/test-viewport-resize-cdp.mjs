// Regression test: dragging a side panel in a split viewport layout.
//
// Cornerstone clears a canvas whenever RenderingEngine.resize() changes its
// backing buffer and only redraws on the next animation frame. The viewer must
// therefore never resize buffers while a panel is being dragged (panes stay
// CSS-scaled), then settle once: every canvas matches its cell, no resize
// snapshot is left behind, and every pane keeps the frame it was showing.
//
// Requires `yarn dev` and Chrome with --remote-debugging-port (see CDP_ORIGIN).

const DEFAULT_STUDY_UID =
  '1.3.6.1.4.1.14519.5.2.1.1188.4001.866856253970500879015300047605';
const RENDERER_ID = 'main-renderer';
const PRIMARY_VIEWPORT_ID = 'WORKSTATION_VIEWPORT';
const SECONDARY_VIEWPORT_ID = 'WORKSTATION_VIEWPORT_2';
const VIEWPORT_IDS = [PRIMARY_VIEWPORT_ID, SECONDARY_VIEWPORT_ID];
const DRAG_DISTANCE_PX = 120;
const DRAG_STEPS = 12;
const CAMERA_TOLERANCE = 0.03;

const cdpOrigin = process.env.CDP_ORIGIN ?? 'http://127.0.0.1:9222';
const viewerOrigin = process.env.VIEWER_ORIGIN ?? 'http://127.0.0.1:3000';
const viewerUrl =
  process.env.VIEWER_URL ??
  `${viewerOrigin}/viewer?StudyInstanceUIDs=${
    process.env.STUDY_INSTANCE_UID ?? DEFAULT_STUDY_UID
  }`;

const runtimeErrors = [];
let socket = null;
let browserContextId = null;
let targetId = null;
let pageSessionId = null;
let commandId = 0;
const pendingCommands = new Map();

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function preflight() {
  try {
    const response = await fetchWithTimeout(
      viewerUrl,
      { method: 'HEAD', redirect: 'follow' },
      15000
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    throw new Error(
      `Viewer is unavailable at ${viewerUrl}. Start it first (yarn dev). ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  let version;
  try {
    version = await (
      await fetchWithTimeout(`${cdpOrigin}/json/version`, {}, 5000)
    ).json();
  } catch (error) {
    throw new Error(
      `Chrome DevTools Protocol is unavailable at ${cdpOrigin}. Start Chrome ` +
        `with remote debugging enabled. ${
          error instanceof Error ? error.message : String(error)
        }`
    );
  }
  if (!version?.webSocketDebuggerUrl) {
    throw new Error(`CDP at ${cdpOrigin} has no webSocketDebuggerUrl.`);
  }
  return version.webSocketDebuggerUrl;
}

async function connectSocket(webSocketDebuggerUrl) {
  const nextSocket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error('Timed out connecting to the CDP WebSocket.')),
      5000
    );
    nextSocket.addEventListener('open', () => {
      clearTimeout(timeoutId);
      resolve();
    }, { once: true });
    nextSocket.addEventListener('error', () => {
      clearTimeout(timeoutId);
      reject(new Error('Could not connect to the CDP WebSocket.'));
    }, { once: true });
  });

  nextSocket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const handler = pendingCommands.get(message.id);
      if (!handler) return;
      pendingCommands.delete(message.id);
      if (message.error) handler.reject(new Error(message.error.message));
      else handler.resolve(message.result);
      return;
    }
    if (
      message.method === 'Runtime.exceptionThrown' ||
      (message.method === 'Log.entryAdded' &&
        message.params?.entry?.level === 'error')
    ) {
      runtimeErrors.push(message.params);
    }
  });

  nextSocket.addEventListener('close', () => {
    for (const { reject } of pendingCommands.values()) {
      reject(new Error('CDP WebSocket closed before the command completed.'));
    }
    pendingCommands.clear();
  });

  return nextSocket;
}

function send(method, params = {}, sessionId) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error(`Cannot send ${method}: socket closed.`));
  }
  const id = ++commandId;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  socket.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    pendingCommands.set(id, { resolve, reject });
  });
}

async function evaluate(expression) {
  const response = await send(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true, userGesture: true },
    pageSessionId
  );
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text
    );
  }
  return response.result?.value;
}

async function waitFor(expression, label, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(expression)) return;
    await delay(200);
  }
  const diagnostic = await evaluate(`(${paneStatesExpression})`);
  throw new Error(
    `Timed out waiting for ${label}. Panes: ${JSON.stringify(diagnostic)}`
  );
}

async function center(expression) {
  const point = await evaluate(`(() => {
    const element = ${expression};
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Missing element: ${expression}`);
  return point;
}

async function mouse(type, point, buttons) {
  await send(
    'Input.dispatchMouseEvent',
    {
      type,
      ...point,
      button: type === 'mouseMoved' && buttons === 0 ? 'none' : 'left',
      buttons,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    },
    pageSessionId
  );
}

async function clickElement(expression) {
  const point = await center(expression);
  await mouse('mouseMoved', point, 0);
  await mouse('mousePressed', point, 1);
  await mouse('mouseReleased', point, 0);
}

// Per pane: Cornerstone camera plus canvas backing/CSS size.
const paneStatesExpression = `(() => {
  const engine = window.__cornerstoneCore?.getRenderingEngine?.('${RENDERER_ID}');
  const pixelRatio = window.devicePixelRatio || 1;
  return ${JSON.stringify(VIEWPORT_IDS)}.map((viewportId) => {
    const viewport = engine?.getViewport?.(viewportId);
    const canvas = viewport?.element?.querySelector('canvas.cornerstone-canvas');
    if (!viewport || !canvas) return { viewportId, missing: true };
    let imageId = null;
    let parallelScale = null;
    try { imageId = viewport.getCurrentImageId?.() ?? null; } catch {}
    try { parallelScale = viewport.getCamera?.()?.parallelScale ?? null; } catch {}
    return {
      viewportId,
      imageId,
      status: String(viewport.viewportStatus ?? '').toLowerCase(),
      parallelScale,
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      bufferMatches:
        canvas.width === Math.floor(canvas.clientWidth * pixelRatio) &&
        canvas.height === Math.floor(canvas.clientHeight * pixelRatio),
    };
  });
})()`;

const panesReadyExpression = `(() => {
  const panes = ${paneStatesExpression};
  return panes.every((pane) =>
    !pane.missing && pane.imageId && pane.status === 'rendered' &&
    pane.parallelScale > 0 && pane.bufferMatches
  );
})()`;

// Counts engine.resize() calls, split by whether a panel drag is active.
const installResizeProbeExpression = `(() => {
  const engine = window.__cornerstoneCore?.getRenderingEngine?.('${RENDERER_ID}');
  if (!engine) return false;
  const probe = (window.__viewerResizeProbe = { duringDrag: 0, total: 0 });
  if (!engine.__viewerResizeProbeInstalled) {
    const originalResize = engine.resize.bind(engine);
    engine.resize = (...args) => {
      const activeProbe = window.__viewerResizeProbe;
      if (activeProbe) {
        activeProbe.total += 1;
        const grid = document.querySelector('.viewer-workspace-grid');
        if (grid?.dataset.panelResizing === 'true') activeProbe.duringDrag += 1;
      }
      return originalResize(...args);
    };
    engine.__viewerResizeProbeInstalled = true;
  }
  return Boolean(probe);
})()`;

function expectedVisibleFrameScale(before, after) {
  const widthRatio = after.clientWidth / before.clientWidth;
  const heightRatio = after.clientHeight / before.clientHeight;
  return (before.parallelScale * heightRatio) / Math.min(widthRatio, heightRatio);
}

async function initializePage() {
  ({ browserContextId } = await send('Target.createBrowserContext', {
    disposeOnDetach: true,
  }));
  ({ targetId } = await send('Target.createTarget', {
    url: viewerUrl,
    browserContextId,
  }));
  ({ sessionId: pageSessionId } = await send('Target.attachToTarget', {
    targetId,
    flatten: true,
  }));
  await Promise.all([
    send('Page.enable', {}, pageSessionId),
    send('Runtime.enable', {}, pageSessionId),
    send('Log.enable', {}, pageSessionId),
  ]);
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false },
    pageSessionId
  );
}

async function runResizeRegression() {
  await waitFor(
    `document.readyState === 'complete' &&
      Boolean(document.querySelector('[data-testid="viewport-layout-trigger"]')) &&
      (${paneStatesExpression})[0]?.status === 'rendered'`,
    'primary viewport to render',
    60000
  );

  await clickElement(
    `document.querySelector('[data-testid="viewport-layout-trigger"]')`
  );
  const presetSelector =
    '[data-testid="viewport-layout-popover"] button[aria-label="Bố cục 1 hàng 2 cột"]';
  await waitFor(
    `Boolean(document.querySelector(${JSON.stringify(presetSelector)}))`,
    '1 x 2 layout preset'
  );
  await clickElement(`document.querySelector(${JSON.stringify(presetSelector)})`);
  await waitFor(panesReadyExpression, 'both panes to render in 1 x 2', 60000);

  // Let the layout-change settling passes (up to 1.2 s) finish first.
  await delay(1800);
  await waitFor(panesReadyExpression, 'panes to settle after layout change');
  const before = await evaluate(paneStatesExpression);

  if (!(await evaluate(installResizeProbeExpression))) {
    throw new Error('Could not instrument RenderingEngine.resize().');
  }

  const handle = await center(
    `document.querySelector('.viewer-panel-resize-handle-left')`
  );
  await mouse('mouseMoved', handle, 0);
  await mouse('mousePressed', handle, 1);
  for (let step = 1; step <= DRAG_STEPS; step += 1) {
    await mouse(
      'mouseMoved',
      { x: handle.x + (DRAG_DISTANCE_PX * step) / DRAG_STEPS, y: handle.y },
      1
    );
    await delay(24);
  }
  // Hold the pointer: ResizeObservers and settle timers get time to fire.
  await delay(400);
  const midDrag = await evaluate(`({
    probe: { ...window.__viewerResizeProbe },
    panelResizing:
      document.querySelector('.viewer-workspace-grid')?.dataset.panelResizing ?? null,
  })`);
  await mouse(
    'mouseReleased',
    { x: handle.x + DRAG_DISTANCE_PX, y: handle.y },
    0
  );

  await delay(900);
  await waitFor(panesReadyExpression, 'panes to settle after the drag');
  const after = await evaluate(paneStatesExpression);
  const afterDrag = await evaluate(`({
    probe: { ...window.__viewerResizeProbe },
    leftoverSnapshots:
      document.querySelectorAll('[data-viewer-resize-snapshot="true"]').length,
  })`);

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

  if (runtimeErrors.length > 0) {
    failures.push(`${runtimeErrors.length} runtime error(s)`);
  }

  const summary = {
    resizeCallsWhileDragging: midDrag.probe.duringDrag,
    resizeCallsTotal: afterDrag.probe.total,
    leftoverSnapshots: afterDrag.leftoverSnapshots,
    cameras,
    runtimeErrors,
  };
  if (failures.length > 0) {
    throw new Error(
      `${failures.join('; ')}\n${JSON.stringify(summary, null, 2)}`
    );
  }
  return summary;
}

async function cleanup() {
  if (targetId && socket?.readyState === WebSocket.OPEN) {
    try { await send('Target.closeTarget', { targetId }); } catch {}
  }
  if (browserContextId && socket?.readyState === WebSocket.OPEN) {
    try {
      await send('Target.disposeBrowserContext', { browserContextId });
    } catch {}
  }
  try { socket?.close(); } catch {}
}

try {
  socket = await connectSocket(await preflight());
  await initializePage();
  const summary = await runResizeRegression();
  console.log(JSON.stringify(summary, null, 2));
  console.log('[test:viewer:resize] passed');
} catch (error) {
  console.error(
    `[test:viewer:resize] ${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }`
  );
  process.exitCode = 1;
} finally {
  await cleanup();
}

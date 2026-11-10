// Minimal Chrome DevTools Protocol harness shared by the viewer regressions.
//
// Requires `yarn dev` and Chrome started with --remote-debugging-port
// (override the endpoints with CDP_ORIGIN, VIEWER_ORIGIN or VIEWER_URL).

export const DEFAULT_STUDY_UID =
  '1.3.6.1.4.1.14519.5.2.1.1188.4001.866856253970500879015300047605';
export const RENDERER_ID = 'main-renderer';
export const PRIMARY_VIEWPORT_ID = 'WORKSTATION_VIEWPORT';
export const SECONDARY_VIEWPORT_ID = 'WORKSTATION_VIEWPORT_2';

export const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/**
 * Page expression that resolves once an opened Radix menu or popover can be
 * clicked reliably:
 * - Radix registers the outside-pointerdown listener in a setTimeout(0) after
 *   mount while body pointer events are already disabled, and Chrome runs
 *   input before timers. Two frames plus one timer tick (equal-delay timers
 *   run in FIFO order) guarantee the listener exists.
 * - Menus open with a zoom-in-95 animation. A centre measured mid-animation
 *   lands on the previous item once the menu reaches full size, so wait for
 *   every finite animation inside a popper to finish before measuring.
 */
export const MENU_READY_EXPRESSION = `(async () => {
  await new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    });
  });
  const animations = document.getAnimations().filter((animation) => {
    const target = animation.effect?.target;
    const iterations = animation.effect?.getComputedTiming?.().iterations;
    return (
      target instanceof Element &&
      Boolean(target.closest('[data-radix-popper-content-wrapper]')) &&
      Number.isFinite(iterations)
    );
  });
  await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
})()`;

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function resolveViewerUrl() {
  const viewerOrigin = process.env.VIEWER_ORIGIN ?? 'http://127.0.0.1:3000';
  return (
    process.env.VIEWER_URL ??
    `${viewerOrigin}/viewer?StudyInstanceUIDs=${
      process.env.STUDY_INSTANCE_UID ?? DEFAULT_STUDY_UID
    }`
  );
}

async function preflight(viewerUrl, cdpOrigin) {
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

/** Opens the viewer in an isolated browser context and returns page helpers. */
export async function openViewerPage({
  width = 1600,
  height = 1000,
  deviceScaleFactor = 1,
} = {}) {
  const viewerUrl = resolveViewerUrl();
  const cdpOrigin = process.env.CDP_ORIGIN ?? 'http://127.0.0.1:9222';
  const socketUrl = await preflight(viewerUrl, cdpOrigin);

  const runtimeErrors = [];
  const pendingCommands = new Map();
  let commandId = 0;
  const socket = new WebSocket(socketUrl);

  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(
      () => reject(new Error('Timed out connecting to the CDP WebSocket.')),
      5000
    );
    socket.addEventListener('open', () => {
      clearTimeout(timeoutId);
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeoutId);
      reject(new Error('Could not connect to the CDP WebSocket.'));
    }, { once: true });
  });

  socket.addEventListener('message', (event) => {
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
  socket.addEventListener('close', () => {
    for (const { reject } of pendingCommands.values()) {
      reject(new Error('CDP WebSocket closed before the command completed.'));
    }
    pendingCommands.clear();
  });

  const send = (method, params = {}, sessionId) => {
    if (socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Cannot send ${method}: socket closed.`));
    }
    const id = ++commandId;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    socket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      pendingCommands.set(id, { resolve, reject });
    });
  };

  const { browserContextId } = await send('Target.createBrowserContext', {
    disposeOnDetach: true,
  });
  const { targetId } = await send('Target.createTarget', {
    url: viewerUrl,
    browserContextId,
  });
  const { sessionId } = await send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  await Promise.all([
    send('Page.enable', {}, sessionId),
    send('Runtime.enable', {}, sessionId),
    send('Log.enable', {}, sessionId),
  ]);
  await send(
    'Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor, mobile: false },
    sessionId
  );

  const evaluate = async (expression) => {
    const response = await send(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      sessionId
    );
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text
      );
    }
    return response.result?.value;
  };

  const waitFor = async (expression, label, { timeoutMs = 30000, diagnostic } = {}) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (await evaluate(expression)) return;
      await delay(200);
    }
    const details = diagnostic ? await evaluate(diagnostic) : null;
    throw new Error(
      `Timed out waiting for ${label}.${
        details ? ` Diagnostic: ${JSON.stringify(details)}` : ''
      }`
    );
  };

  const center = async (expression, { x = 0.5, y = 0.5 } = {}) => {
    const point = await evaluate(`(() => {
      const element = ${expression};
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        x: rect.left + rect.width * ${x},
        y: rect.top + rect.height * ${y},
      };
    })()`);
    if (!point) throw new Error(`Missing element: ${expression}`);
    return point;
  };

  const mouse = (type, point, buttons) =>
    send(
      'Input.dispatchMouseEvent',
      {
        type,
        ...point,
        button: type === 'mouseMoved' && buttons === 0 ? 'none' : 'left',
        buttons,
        clickCount: type === 'mouseMoved' ? 0 : 1,
      },
      sessionId
    );

  const click = async (point) => {
    await mouse('mouseMoved', point, 0);
    await mouse('mousePressed', point, 1);
    await mouse('mouseReleased', point, 0);
  };

  const drag = async (start, end, steps = 8) => {
    await mouse('mouseMoved', start, 0);
    await mouse('mousePressed', start, 1);
    for (let step = 1; step <= steps; step += 1) {
      await mouse(
        'mouseMoved',
        {
          x: start.x + ((end.x - start.x) * step) / steps,
          y: start.y + ((end.y - start.y) * step) / steps,
        },
        1
      );
    }
    await mouse('mouseReleased', end, 0);
  };

  const waitForMenuInteractive = () => evaluate(MENU_READY_EXPRESSION);

  const close = async () => {
    if (socket.readyState === WebSocket.OPEN) {
      try { await send('Target.closeTarget', { targetId }); } catch {}
      try { await send('Target.disposeBrowserContext', { browserContextId }); } catch {}
    }
    try { socket.close(); } catch {}
  };

  return {
    runtimeErrors,
    evaluate,
    waitFor,
    center,
    mouse,
    click,
    drag,
    waitForMenuInteractive,
    close,
  };
}

/** Runs one regression with uniform reporting and exit code handling. */
export async function runRegression(label, run) {
  let page = null;
  try {
    page = await openViewerPage();
    const summary = await run(page);
    console.log(JSON.stringify(summary, null, 2));
    console.log(`[${label}] passed`);
  } catch (error) {
    console.error(
      `[${label}] ${
        error instanceof Error ? error.stack ?? error.message : String(error)
      }`
    );
    process.exitCode = 1;
  } finally {
    await page?.close();
  }
}

/** Per pane: Cornerstone camera, current image and canvas backing/CSS size. */
export function paneStatesExpression(viewportIds) {
  return `(() => {
    const engine = window.__cornerstoneCore?.getRenderingEngine?.('${RENDERER_ID}');
    const pixelRatio = window.devicePixelRatio || 1;
    return ${JSON.stringify(viewportIds)}.map((viewportId) => {
      const viewport = engine?.getViewport?.(viewportId);
      const canvas = viewport?.element?.querySelector('canvas.cornerstone-canvas');
      if (!viewport || !canvas) return { viewportId, missing: true };
      let imageId = null;
      let imageIndex = null;
      let parallelScale = null;
      try { imageId = viewport.getCurrentImageId?.() ?? null; } catch {}
      try { imageIndex = viewport.getCurrentImageIdIndex?.() ?? null; } catch {}
      try { parallelScale = viewport.getCamera?.()?.parallelScale ?? null; } catch {}
      return {
        viewportId,
        imageId,
        imageIndex,
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
}

export function panesReadyExpression(viewportIds) {
  return `(() => {
    const panes = ${paneStatesExpression(viewportIds)};
    return panes.every((pane) =>
      !pane.missing && pane.imageId && pane.status === 'rendered' &&
      pane.parallelScale > 0 && pane.bufferMatches
    );
  })()`;
}

/**
 * Resize snapshots are transient: each is released after the next render of
 * its pane (500 ms at the latest) plus two frames. Wait for them instead of
 * sampling once; returns the snapshots still present after `timeoutMs`.
 */
export async function waitForResizeSnapshotsReleased(page, timeoutMs = 3000) {
  const count = `document.querySelectorAll('[data-viewer-resize-snapshot="true"]').length`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if ((await page.evaluate(count)) === 0) return 0;
    await delay(100);
  }
  return page.evaluate(count);
}

/** Viewport IDs of a rows x columns grid, matching getViewportIdAt(). */
export function gridViewportIds(rows, columns) {
  return Array.from({ length: rows * columns }, (_, index) =>
    index === 0 ? PRIMARY_VIEWPORT_ID : `${PRIMARY_VIEWPORT_ID}_${index + 1}`
  );
}

export async function waitForPrimaryViewport(page) {
  await page.waitFor(
    `document.readyState === 'complete' &&
      Boolean(document.querySelector('[data-testid="viewport-layout-trigger"]')) &&
      (${paneStatesExpression([PRIMARY_VIEWPORT_ID])})[0]?.status === 'rendered'`,
    'primary viewport to render',
    { timeoutMs: 60000 }
  );
}

/**
 * Applies a preset from the toolbar layout popover and waits until every
 * pane rendered and the layout-change settling passes (up to 1.2 s) ended.
 */
export async function applyLayoutPreset(page, rows, columns) {
  const viewportIds = gridViewportIds(rows, columns);
  await page.click(
    await page.center(
      `document.querySelector('[data-testid="viewport-layout-trigger"]')`
    )
  );
  const presetSelector =
    `[data-testid="viewport-layout-popover"] ` +
    `button[aria-label="Bố cục ${rows} hàng ${columns} cột"]`;
  await page.waitFor(
    `Boolean(document.querySelector(${JSON.stringify(presetSelector)}))`,
    `${rows} x ${columns} layout preset`
  );
  await page.waitForMenuInteractive();
  await page.click(
    await page.center(`document.querySelector(${JSON.stringify(presetSelector)})`)
  );
  await page.waitFor(
    panesReadyExpression(viewportIds),
    `every pane to render in ${rows} x ${columns}`,
    { timeoutMs: 60000, diagnostic: paneStatesExpression(viewportIds) }
  );

  await delay(1800);
  await page.waitFor(
    panesReadyExpression(viewportIds),
    `panes to settle after switching to ${rows} x ${columns}`,
    { diagnostic: paneStatesExpression(viewportIds) }
  );
  return viewportIds;
}

/** Waits for the primary pane, then switches the grid to one row, two columns. */
export async function openSplitLayout(page) {
  await waitForPrimaryViewport(page);
  return applyLayoutPreset(page, 1, 2);
}

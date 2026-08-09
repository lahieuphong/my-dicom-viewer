const DEFAULT_STUDY_UID =
  '1.3.6.1.4.1.14519.5.2.1.1188.4001.866856253970500879015300047605';
const VIEWPORT_ID = 'WORKSTATION_VIEWPORT';
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
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function preflightViewer() {
  let response;
  try {
    response = await fetchWithTimeout(
      viewerUrl,
      { method: 'HEAD', redirect: 'follow' },
      15000
    );
  } catch (error) {
    throw new Error(
      `Viewer is unavailable at ${viewerUrl}. Start it first (for example: yarn dev). ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!response.ok) {
    throw new Error(
      `Viewer preflight returned HTTP ${response.status} for ${viewerUrl}.`
    );
  }
}

async function readCdpVersion() {
  const versionUrl = `${cdpOrigin}/json/version`;
  let response;

  try {
    response = await fetchWithTimeout(versionUrl, {}, 5000);
  } catch (error) {
    throw new Error(
      `Chrome DevTools Protocol is unavailable at ${versionUrl}. ` +
        `Start Chrome with remote debugging enabled. ${
          error instanceof Error ? error.message : String(error)
        }`
    );
  }

  if (!response.ok) {
    throw new Error(
      `CDP preflight returned HTTP ${response.status} for ${versionUrl}.`
    );
  }

  const version = await response.json();
  if (!version?.webSocketDebuggerUrl) {
    throw new Error(
      `CDP response at ${versionUrl} has no webSocketDebuggerUrl.`
    );
  }
  return version;
}

async function connectSocket(webSocketDebuggerUrl) {
  const nextSocket = new WebSocket(webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(
        new Error(`Timed out connecting to CDP WebSocket at ${webSocketDebuggerUrl}.`)
      );
    }, 5000);

    nextSocket.addEventListener(
      'open',
      () => {
        clearTimeout(timeoutId);
        resolve();
      },
      { once: true }
    );
    nextSocket.addEventListener(
      'error',
      () => {
        clearTimeout(timeoutId);
        reject(
          new Error(`Could not connect to CDP WebSocket at ${webSocketDebuggerUrl}.`)
        );
      },
      { once: true }
    );
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
    return Promise.reject(new Error(`Cannot send ${method}: CDP socket is not open.`));
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
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    },
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

  const diagnostic = await evaluate(`(() => {
    const viewportElement = document.querySelector(
      '[data-viewport-uid="${VIEWPORT_ID}"]'
    );
    let viewport = null;
    try {
      const core = window.__cornerstoneCore;
      viewport =
        core?.getEnabledElementByViewportId?.('${VIEWPORT_ID}')?.viewport ??
        core?.getEnabledElement?.(viewportElement)?.viewport ??
        null;
    } catch {}

    return {
      url: location.href,
      readyState: document.readyState,
      body: document.body.innerText.slice(-3000),
      viewport: viewport
        ? {
            invert: Boolean(viewport.getProperties?.()?.invert),
            currentIndex: viewport.getCurrentImageIdIndex?.(),
            imageCount: viewport.getImageIds?.()?.length,
            viewportStatus: String(viewport.viewportStatus ?? ''),
          }
        : null,
      otherTrigger: (() => {
        const trigger = document.querySelector('[data-testid="other-tools-trigger"]');
        return trigger
          ? {
              disabled: trigger.disabled,
              displayedItem: trigger.getAttribute('data-displayed-item'),
            }
          : null;
      })(),
      cineOpen: Boolean(document.querySelector('[data-testid="cine-player"]')),
    };
  })()`);

  throw new Error(
    `Timed out waiting for ${label}. Diagnostic: ${JSON.stringify(diagnostic)}`
  );
}

async function center(expression) {
  const point = await evaluate(`(() => {
    const element = ${expression};
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  })()`);
  if (!point) throw new Error(`Missing element: ${expression}`);
  return point;
}

async function clickElement(expression) {
  const point = await center(expression);
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', ...point },
    pageSessionId
  );
  await send(
    'Input.dispatchMouseEvent',
    {
      type: 'mousePressed',
      ...point,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    },
    pageSessionId
  );
  await send(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    },
    pageSessionId
  );
}

async function pressKey(key, code, windowsVirtualKeyCode) {
  await send(
    'Input.dispatchKeyEvent',
    {
      type: 'rawKeyDown',
      key,
      code,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode,
    },
    pageSessionId
  );
  await send(
    'Input.dispatchKeyEvent',
    {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode,
      nativeVirtualKeyCode: windowsVirtualKeyCode,
    },
    pageSessionId
  );
}

const viewportStateExpression = `(() => {
  const viewportElement = document.querySelector(
    '[data-viewport-uid="${VIEWPORT_ID}"]'
  );
  if (!viewportElement) return null;

  try {
    const core = window.__cornerstoneCore;
    const enabledElement =
      core?.getEnabledElementByViewportId?.('${VIEWPORT_ID}') ??
      core?.getEnabledElement?.(viewportElement) ??
      null;
    const viewport = enabledElement?.viewport;
    if (!viewport) return null;

    const imageIds = viewport.getImageIds?.() ?? [];
    return {
      invert: Boolean(viewport.getProperties?.()?.invert),
      currentIndex: viewport.getCurrentImageIdIndex?.(),
      imageCount: imageIds.length,
      currentImageId: viewport.getCurrentImageId?.() ?? null,
      viewportStatus: String(viewport.viewportStatus ?? '').toLowerCase(),
    };
  } catch {
    return null;
  }
})()`;

async function readViewportState() {
  const state = await evaluate(viewportStateExpression);
  if (!state) throw new Error('Cornerstone StackViewport is unavailable.');
  return state;
}

async function openOtherMenu() {
  if (
    await evaluate(
      `Boolean(document.querySelector('[data-testid="other-tools-menu"]'))`
    )
  ) {
    return;
  }

  await clickElement(
    `document.querySelector('[data-testid="other-tools-trigger"]')`
  );
  await waitFor(
    `Boolean(document.querySelector('[data-testid="other-tools-menu"]'))`,
    'Other menu to open'
  );
}

async function selectOtherItem(itemId) {
  await openOtherMenu();
  const selector =
    `[data-testid="other-tools-menu"] [data-other-item="${itemId}"]`;
  await waitFor(
    `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
    `${itemId} item to exist in Other menu`
  );
  await clickElement(`document.querySelector(${JSON.stringify(selector)})`);
  await waitFor(
    `!document.querySelector('[data-testid="other-tools-menu"]')`,
    `Other menu to close after selecting ${itemId}`
  );
}

async function assertInvert(expected, label, timeoutMs = 30000) {
  await waitFor(
    `(${viewportStateExpression})?.invert === ${JSON.stringify(expected)}`,
    label,
    timeoutMs
  );
}

async function assertInvertMenuState(expected, label) {
  await openOtherMenu();
  const selector =
    '[data-testid="other-tools-menu"] [data-other-item="invert"]';
  await waitFor(
    `(() => {
      const item = document.querySelector(${JSON.stringify(selector)});
      return Boolean(item) && item.getAttribute('aria-disabled') !== 'true';
    })()`,
    `${label}: enabled Invert menu item`
  );

  const state = await evaluate(`(() => {
    const item = document.querySelector(${JSON.stringify(selector)});
    return item
      ? {
          label: item.textContent?.trim() ?? '',
          role: item.getAttribute('role'),
          ariaChecked: item.getAttribute('aria-checked'),
          dataActive: item.getAttribute('data-active'),
        }
      : null;
  })()`);

  const expectedState = String(expected);
  if (
    !state ||
    state.label !== 'Ảnh dương bản' ||
    state.role !== 'menuitemcheckbox' ||
    state.ariaChecked !== expectedState ||
    state.dataActive !== expectedState
  ) {
    throw new Error(
      `${label}: Invert menu UI is out of sync. ${JSON.stringify(state)}`
    );
  }

  await clickElement(
    `document.querySelector('[data-testid="other-tools-trigger"]')`
  );
  await waitFor(
    `!document.querySelector('[data-testid="other-tools-menu"]')`,
    `${label}: Other menu to close`
  );
}

async function assertZoomStillActive(label) {
  const zoomIsActive = await evaluate(`(() => {
    const button = document.querySelector('[data-testid="toolbar-tool-zoom"]');
    return Boolean(button?.classList.contains('bg-primary'));
  })()`);
  if (!zoomIsActive) {
    throw new Error(`${label}: Invert changed the active mouse toolbar tool.`);
  }
}

async function initializePage() {
  const { browserContextId: contextId } = await send(
    'Target.createBrowserContext',
    { disposeOnDetach: true }
  );
  browserContextId = contextId;

  const createdTarget = await send('Target.createTarget', {
    url: viewerUrl,
    browserContextId,
  });
  targetId = createdTarget.targetId;

  const attached = await send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  pageSessionId = attached.sessionId;

  await Promise.all([
    send('Page.enable', {}, pageSessionId),
    send('Runtime.enable', {}, pageSessionId),
    send('Log.enable', {}, pageSessionId),
  ]);
  await send(
    'Emulation.setDeviceMetricsOverride',
    {
      width: 1600,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    },
    pageSessionId
  );
}

async function runInvertRegression() {
  await waitFor(
    `document.readyState === 'complete' &&
      Boolean(document.querySelector('[data-testid="other-tools-trigger"]')) &&
      Boolean(document.querySelector('[data-viewport-uid="${VIEWPORT_ID}"]')) &&
      (() => {
        const state = ${viewportStateExpression};
        return Boolean(
          state?.currentImageId &&
          state.imageCount > 0 &&
          state.viewportStatus === 'rendered'
        );
      })()`,
    'viewer and Cornerstone viewport to become ready',
    60000
  );

  const baseline = await readViewportState();

  await clickElement(
    `document.querySelector('[data-testid="toolbar-tool-zoom"]')`
  );
  await waitFor(
    `document.querySelector('[data-testid="toolbar-tool-zoom"]')
      ?.classList.contains('bg-primary') === true`,
    'Zoom to become the active mouse toolbar tool'
  );

  await assertInvertMenuState(baseline.invert, 'Initial state');
  await openOtherMenu();

  await clickElement(
    `document.querySelector(
      '[data-testid="other-tools-menu"] [data-other-item="invert"]'
    )`
  );
  await waitFor(
    `!document.querySelector('[data-testid="other-tools-menu"]')`,
    'Other menu to close after the first Invert toggle'
  );
  await assertInvert(!baseline.invert, 'first Invert toggle to apply');
  await assertZoomStillActive('First toggle');
  await assertInvertMenuState(!baseline.invert, 'First toggle');

  const displayedItem = await evaluate(
    `document.querySelector('[data-testid="other-tools-trigger"]')
      ?.getAttribute('data-displayed-item')`
  );
  const expectedDisplayedItem = !baseline.invert ? 'invert' : 'more';
  if (displayedItem !== expectedDisplayedItem) {
    throw new Error(
      `Other trigger did not reflect the applied Invert state. Expected ${JSON.stringify(
        expectedDisplayedItem
      )}, received ${JSON.stringify(displayedItem)}.`
    );
  }

  await selectOtherItem('invert');
  await assertInvert(baseline.invert, 'second Invert toggle to restore baseline');
  await assertZoomStillActive('Second toggle');
  await assertInvertMenuState(baseline.invert, 'Second toggle');

  await selectOtherItem('invert');
  await assertInvert(!baseline.invert, 'Invert before frame navigation');

  const stackState = await readViewportState();
  if (stackState.imageCount < 2) {
    throw new Error(
      `Frame persistence needs a multi-frame stack; found ${stackState.imageCount} image.`
    );
  }

  const scrollbarSelector =
    '[role="scrollbar"][aria-label="Điều hướng lát cắt DICOM"]';
  await waitFor(
    `Boolean(document.querySelector(${JSON.stringify(scrollbarSelector)}))`,
    'viewport stack scrollbar to exist'
  );
  await evaluate(`document.querySelector(${JSON.stringify(scrollbarSelector)}).focus()`);
  await pressKey('End', 'End', 35);
  await waitFor(
    `(() => {
      const state = ${viewportStateExpression};
      const scrollbar = document.querySelector(${JSON.stringify(scrollbarSelector)});
      return state?.currentIndex === state?.imageCount - 1 &&
        scrollbar?.getAttribute('aria-valuenow') ===
          scrollbar?.getAttribute('aria-valuemax');
    })()`,
    'End to navigate to the final frame',
    60000
  );
  await assertInvert(
    !baseline.invert,
    'Invert to persist on the final frame'
  );

  await pressKey('Home', 'Home', 36);
  await waitFor(
    `(() => {
      const state = ${viewportStateExpression};
      const scrollbar = document.querySelector(${JSON.stringify(scrollbarSelector)});
      return state?.currentIndex === 0 &&
        scrollbar?.getAttribute('aria-valuenow') === '1';
    })()`,
    'Home to navigate back to the first frame',
    60000
  );
  await assertInvert(
    !baseline.invert,
    'Invert to persist after returning to the first frame'
  );
  await assertInvertMenuState(!baseline.invert, 'Frame navigation');

  await selectOtherItem('reset');
  await assertInvert(
    baseline.invert,
    'Reset View to restore the original image presentation'
  );
  await assertInvertMenuState(baseline.invert, 'Reset View');

  await selectOtherItem('cine');
  await waitFor(
    `Boolean(document.querySelector('[data-testid="cine-player"]'))`,
    'Cine controls to open'
  );
  await waitFor(
    `document.querySelector('[data-testid="other-tools-trigger"]')?.disabled === false`,
    'Cine preparation to release the toolbar',
    120000
  );

  await selectOtherItem('invert');
  await waitFor(
    `!document.querySelector('[data-testid="cine-player"]')`,
    'Cine controls to close when Invert is selected'
  );
  await assertInvert(!baseline.invert, 'Invert selected after Cine');
  await assertInvertMenuState(!baseline.invert, 'Invert after Cine');

  // Leave the viewport in its original polarity for repeatable local runs.
  await selectOtherItem('invert');
  await assertInvert(baseline.invert, 'final cleanup toggle to restore baseline');

  if (runtimeErrors.length > 0) {
    throw new Error(
      `Browser reported ${runtimeErrors.length} runtime error(s): ${JSON.stringify(
        runtimeErrors.slice(0, 5)
      )}`
    );
  }

  return {
    viewerUrl,
    baselineInvert: baseline.invert,
    imageCount: baseline.imageCount,
    checks: [
      'Other menu item',
      'toggle on/off',
      'active mouse tool preserved',
      'frame persistence',
      'Reset View baseline',
      'Cine closes on Invert',
    ],
  };
}

async function cleanup() {
  if (targetId && socket?.readyState === WebSocket.OPEN) {
    try {
      await send('Target.closeTarget', { targetId });
    } catch {}
  }
  if (browserContextId && socket?.readyState === WebSocket.OPEN) {
    try {
      await send('Target.disposeBrowserContext', { browserContextId });
    } catch {}
  }
  try {
    socket?.close();
  } catch {}
}

try {
  await preflightViewer();
  const version = await readCdpVersion();
  socket = await connectSocket(version.webSocketDebuggerUrl);
  await initializePage();
  const summary = await runInvertRegression();
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(
    `[test:viewer:invert] ${
      error instanceof Error ? error.stack ?? error.message : String(error)
    }`
  );
  process.exitCode = 1;
} finally {
  await cleanup();
}

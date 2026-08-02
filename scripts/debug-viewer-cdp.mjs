import fs from 'node:fs';
import path from 'node:path';

const studyUID =
  '1.3.6.1.4.1.14519.5.2.1.1188.4001.866856253970500879015300047605';
const cdpOrigin =
  process.env.CDP_ORIGIN ?? 'http://127.0.0.1:9222';
const viewerOrigin =
  process.env.VIEWER_ORIGIN ?? 'http://127.0.0.1:3000';
const viewerUrl = `${viewerOrigin}/viewer?StudyInstanceUIDs=${studyUID}`;
const downloadPath = `/tmp/dicom-sr-workflow-${Date.now()}`;

fs.mkdirSync(downloadPath, { recursive: true });

const version = await fetch(`${cdpOrigin}/json/version`).then((r) =>
  r.json()
);
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
const events = [];
ws.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id) {
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
    return;
  }
  events.push(message);
});

function send(method, params = {}, sessionId) {
  const id = ++nextId;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

const { browserContextId } = await send('Target.createBrowserContext', {
  disposeOnDetach: true,
});
const { targetId } = await send('Target.createTarget', {
  url: 'about:blank',
  browserContextId,
});
const { sessionId } = await send('Target.attachToTarget', {
  targetId,
  flatten: true,
});

await Promise.all([
  send('Page.enable', {}, sessionId),
  send('Runtime.enable', {}, sessionId),
  send('Console.enable', {}, sessionId),
  send('Log.enable', {}, sessionId),
  send('Network.enable', {}, sessionId),
  send(
    'Browser.setDownloadBehavior',
    {
      behavior: 'allow',
      downloadPath,
      eventsEnabled: true,
      browserContextId,
    }
  ),
]);
await send(
  'Emulation.setDeviceMetricsOverride',
  {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  },
  sessionId
);

async function evaluate(expression, awaitPromise = true) {
  const response = await send(
    'Runtime.evaluate',
    {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    },
    sessionId
  );
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text
    );
  }
  return response.result?.value;
}

async function waitFor(expression, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const diagnostic = await evaluate(`({
    body: document.body.innerText.slice(-5000),
    dialog: document.querySelector('[role="dialog"]')?.innerText ?? null,
    stackScrollbar: (() => {
      const element = document.querySelector(
        '[role="scrollbar"][aria-label="Điều hướng lát cắt DICOM"]'
      );
      return element
        ? {
            value: element.getAttribute('aria-valuenow'),
            tabIndex: element.getAttribute('tabindex'),
            className: element.className,
            focused: document.activeElement === element,
          }
        : null;
    })(),
    runtimeViewport: (() => {
      try {
        const core = window.__cornerstoneCore;
        const enabled = core?.getEnabledElementByViewportId?.(
          'WORKSTATION_VIEWPORT'
        );
        const viewport = enabled?.viewport;
        return {
          currentIndex: viewport?.getCurrentImageIdIndex?.(),
          imageIdCount: viewport?.getImageIds?.()?.length,
          currentImageId: viewport?.getCurrentImageId?.(),
          status: viewport?.viewportStatus,
        };
      } catch (error) {
        return { error: String(error) };
      }
    })(),
  })`);
  const relevantEvents = events
    .filter(
      (event) =>
        event.method === 'Runtime.exceptionThrown' ||
        event.method === 'Runtime.consoleAPICalled' ||
        event.method === 'Log.entryAdded'
    )
    .slice(-20);
  throw new Error(
    `Timed out waiting for: ${expression}\n${JSON.stringify(
      { diagnostic, relevantEvents },
      null,
      2
    )}`
  );
}

async function getElementCenter(expression) {
  const rect = await evaluate(`(() => {
    const element = ${expression};
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  })()`);
  if (!rect) throw new Error(`Element not found: ${expression}`);
  return rect;
}

async function clickElement(expression) {
  const { x, y } = await getElementCenter(expression);
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x, y },
    sessionId
  );
  await send(
    'Input.dispatchMouseEvent',
    {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    },
    sessionId
  );
  await send(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    },
    sessionId
  );
}

async function dragPointer(start, end) {
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', x: start.x, y: start.y },
    sessionId
  );
  await send(
    'Input.dispatchMouseEvent',
    {
      type: 'mousePressed',
      x: start.x,
      y: start.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    },
    sessionId
  );
  await send(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseMoved',
      x: end.x,
      y: end.y,
      button: 'left',
      buttons: 1,
    },
    sessionId
  );
  await send(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseReleased',
      x: end.x,
      y: end.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    },
    sessionId
  );
}

async function pressKey(key, code, virtualKeyCode) {
  await send(
    'Input.dispatchKeyEvent',
    {
      type: 'rawKeyDown',
      key,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    },
    sessionId
  );
  await send(
    'Input.dispatchKeyEvent',
    {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: virtualKeyCode,
      nativeVirtualKeyCode: virtualKeyCode,
    },
    sessionId
  );
}

function annotationRenderedExpression(annotationUID) {
  return `(() =>
    [...document.querySelectorAll(
      '#svg-layer-WORKSTATION_VIEWPORT [data-annotation-uid]'
    )].some(
      (node) =>
        node.getAttribute('data-annotation-uid') ===
        ${JSON.stringify(annotationUID)}
    )
  )()`;
}

async function createSrReport(name) {
  await clickElement(
    `[...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Create SR'
    )`
  );
  await waitFor(`!!document.querySelector('input[aria-label="Tên SR"]')`);
  await evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Tên SR"]');
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set;
    setter.call(input, ${JSON.stringify(name)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await clickElement(
    `[...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Tạo SR'
    )`
  );
  await waitFor(
    `[...document.querySelectorAll('button')].some(
      (button) => button.getAttribute('aria-label') ===
        ${JSON.stringify(`View SR ${name}`)}
    )`,
    60000
  );
  await waitFor(`!document.querySelector('input[aria-label="Tên SR"]')`);
}

await send('Page.navigate', { url: viewerUrl }, sessionId);
await waitFor(
  `document.readyState === 'complete' && !!document.querySelector('canvas')`,
  30000
);
await new Promise((resolve) => setTimeout(resolve, 6000));
await clickElement(
  `document.querySelector('[data-testid="measurement-tools-menu-trigger"]')`
);
await waitFor(
  `!!document.querySelector('[role="menuitem"][data-tool-id="length"]')`
);
await clickElement(
  `document.querySelector('[role="menuitem"][data-tool-id="length"]')`
);
await waitFor(
  `!document.querySelector('[role="menuitem"][data-tool-id="length"]')`
);

const viewportRect = await evaluate(`(() => {
  const element = document.querySelector('[data-viewport-uid="WORKSTATION_VIEWPORT"]');
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
})()`);
const start = {
  x: viewportRect.x + viewportRect.width * 0.38,
  y: viewportRect.y + viewportRect.height * 0.48,
};
const end = {
  x: viewportRect.x + viewportRect.width * 0.62,
  y: viewportRect.y + viewportRect.height * 0.56,
};
await dragPointer(start, end);
await waitFor(`document.body.innerText.includes('Measurement (1)')`);
await waitFor(
  `[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Create SR' && !button.disabled)`
);

const scrollbarExpression = `document.querySelector(
  '[role="scrollbar"][aria-label="Điều hướng lát cắt DICOM"]'
)`;
const totalFrames = Number(
  await evaluate(
    `${scrollbarExpression}?.getAttribute('aria-valuemax') ?? 0`
  )
);
if (!Number.isInteger(totalFrames) || totalFrames < 4) {
  throw new Error(
    `The SR workflow test requires at least four frames; received ${totalFrames}.`
  );
}
await evaluate(`${scrollbarExpression}?.focus()`);
for (let frame = 2; frame <= 4; frame += 1) {
  await evaluate(`${scrollbarExpression}?.focus()`);
  await pressKey('ArrowDown', 'ArrowDown', 40);
  await waitFor(
    `${scrollbarExpression}?.getAttribute('aria-valuenow') === '${frame}'`,
    5000
  );
  await waitFor(
    `document.body.innerText.includes('(${frame}/${totalFrames})')`
  );
}
await dragPointer(
  {
    x: viewportRect.x + viewportRect.width * 0.32,
    y: viewportRect.y + viewportRect.height * 0.62,
  },
  {
    x: viewportRect.x + viewportRect.width * 0.52,
    y: viewportRect.y + viewportRect.height * 0.68,
  }
);
await waitFor(`document.body.innerText.includes('Measurement (2)')`);

const measurementUIDsByFrame = await evaluate(`(() => {
  const result = {};
  for (const card of document.querySelectorAll(
    '[role="button"][data-annotation-uid]'
  )) {
    const frame = card.innerText.match(/I:\\s*(\\d+)\\s*\\//)?.[1];
    const uid = card.getAttribute('data-annotation-uid');
    if (frame && uid) result[frame] = uid;
  }
  return result;
})()`);
const sourceAnnotationUID = measurementUIDsByFrame?.['1'];
const secondAnnotationUID = measurementUIDsByFrame?.['4'];
if (!sourceAnnotationUID || !secondAnnotationUID) {
  throw new Error(
    `Could not resolve the frame 1/frame 4 measurement UIDs: ${JSON.stringify(
      measurementUIDsByFrame
    )}`
  );
}

const isSourceAnnotationRendered = annotationRenderedExpression(
  sourceAnnotationUID
);
const isSecondAnnotationRendered = annotationRenderedExpression(
  secondAnnotationUID
);
await waitFor(isSecondAnnotationRendered);

await evaluate(`${scrollbarExpression}?.focus()`);
await evaluate(`${scrollbarExpression}?.dispatchEvent(
  new KeyboardEvent('keydown', {
    key: 'Home',
    code: 'Home',
    bubbles: true,
    cancelable: true,
  })
)`);
await waitFor(
  `${scrollbarExpression}?.getAttribute('aria-valuenow') === '1'`
);
await waitFor(
  `document.body.innerText.includes('(1/${totalFrames})')`
);
await waitFor(isSourceAnnotationRendered);
if (await evaluate(isSecondAnnotationRendered)) {
  throw new Error('The frame 4 measurement rendered on frame 1.');
}

await clickElement(
  `document.querySelector(
    '[data-annotation-uid=${JSON.stringify(sourceAnnotationUID)}] button[aria-label="Hide measurement"]'
  )`
);
await waitFor(
  `!!document.querySelector('button[aria-label="Show measurement"]')`
);
await waitFor(`!(${isSourceAnnotationRendered})`);

// Selecting/navigating to a hidden measurement must not resurrect it.
await evaluate(
  `document.querySelector(
    '[role="button"][data-annotation-uid=${JSON.stringify(sourceAnnotationUID)}]'
  )?.click()`
);
await waitFor(`!(${isSourceAnnotationRendered})`);

await clickElement(
  `document.querySelector(
    '[data-annotation-uid=${JSON.stringify(sourceAnnotationUID)}] button[aria-label="Show measurement"]'
  )`
);
await waitFor(isSourceAnnotationRendered);

// Keep one source measurement hidden while creating the report. Hidden state
// is a display concern and must not remove it from the SR snapshot.
await clickElement(
  `document.querySelector(
    '[data-annotation-uid=${JSON.stringify(sourceAnnotationUID)}] button[aria-label="Hide measurement"]'
  )`
);
await waitFor(`!(${isSourceAnnotationRendered})`);

await createSrReport('Runtime OHIF SR');
await new Promise((resolve) => setTimeout(resolve, 1500));

const sourceStateAfterExport = await evaluate(`(() => {
  const viewport = document.querySelector(
    '[data-viewport-uid="WORKSTATION_VIEWPORT"]'
  );
  const createButton = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Create SR'
  );
  return {
    viewportText: viewport?.innerText ?? '',
    canvasCount: viewport?.querySelectorAll('canvas.cornerstone-canvas').length ?? 0,
    measurementCountText: document.body.innerText.match(/Measurement \\(\\d+\\)/)?.[0],
    createSrDisabled: createButton?.disabled,
    hiddenMeasurementCount: document.querySelectorAll(
      'button[aria-label="Show measurement"]'
    ).length,
    reportButtons: [...document.querySelectorAll('span[title]')]
      .map((span) => span.getAttribute('title'))
      .filter(Boolean),
  };
})()`);
if (
  sourceStateAfterExport.measurementCountText !== 'Measurement (2)' ||
  sourceStateAfterExport.canvasCount < 1 ||
  sourceStateAfterExport.createSrDisabled ||
  sourceStateAfterExport.hiddenMeasurementCount !== 1 ||
  !sourceStateAfterExport.reportButtons.includes('Runtime OHIF SR')
) {
  throw new Error(
    `Invalid source state after SR export: ${JSON.stringify(
      sourceStateAfterExport
    )}`
  );
}

await evaluate(
  `document.querySelector('span[title="Runtime OHIF SR"]')?.closest('button')?.click()`
);
await waitFor(
  `!![...document.querySelectorAll('button')].find((button) => button.title === 'Close SR')`,
  60000
);
await waitFor(`document.body.innerText.includes('Measurement (2)')`);
await waitFor(`(() => {
  const reportUIDs = new Set(
    [...document.querySelectorAll('[role="button"][data-annotation-uid]')]
      .map((card) => card.getAttribute('data-annotation-uid'))
      .filter(Boolean)
  );
  return [...document.querySelectorAll(
    '#svg-layer-WORKSTATION_VIEWPORT [data-annotation-uid]'
  )].some((node) => reportUIDs.has(node.getAttribute('data-annotation-uid')));
})()`);
await new Promise((resolve) => setTimeout(resolve, 1000));
const srViewState = await evaluate(`(() => {
  const viewport = document.querySelector(
    '[data-viewport-uid="WORKSTATION_VIEWPORT"]'
  );
  const canvas = viewport?.querySelector('canvas.cornerstone-canvas');
  const canvasRect = canvas?.getBoundingClientRect();
  const reportUIDs = new Set(
    [...document.querySelectorAll('[role="button"][data-annotation-uid]')]
      .map((card) => card.getAttribute('data-annotation-uid'))
      .filter(Boolean)
  );
  const renderedReportUIDs = new Set(
    [...document.querySelectorAll(
      '#svg-layer-WORKSTATION_VIEWPORT [data-annotation-uid]'
    )]
      .map((node) => node.getAttribute('data-annotation-uid'))
      .filter((uid) => reportUIDs.has(uid))
  );
  const createButton = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Create SR'
  );
  const runtimeViewport = (() => {
    try {
      const enabled =
        window.__cornerstoneCore?.getEnabledElementByViewportId?.(
          'WORKSTATION_VIEWPORT'
        );
      const cornerstoneViewport = enabled?.viewport;
      return {
        currentImageId: cornerstoneViewport?.getCurrentImageId?.() ?? null,
        currentImageIndex:
          cornerstoneViewport?.getCurrentImageIdIndex?.() ?? null,
        imageIdCount: cornerstoneViewport?.getImageIds?.()?.length ?? 0,
        status: String(cornerstoneViewport?.viewportStatus ?? ''),
      };
    } catch (error) {
      return { error: String(error) };
    }
  })();
  return {
    body: document.body.innerText.slice(-2500),
    measurementCountText: document.body.innerText.match(/Measurement \\(\\d+\\)/)?.[0],
    viewportConnected: Boolean(viewport?.isConnected),
    canvasWidth: canvasRect?.width ?? 0,
    canvasHeight: canvasRect?.height ?? 0,
    runtimeViewport,
    reportAnnotationUIDs: [...reportUIDs],
    reportMeasurementCount: reportUIDs.size,
    renderedReportMeasurementCount: renderedReportUIDs.size,
    sourceAnnotationRendered: ${isSourceAnnotationRendered},
    activeReportPressed: Boolean(
      document.querySelector('button[aria-label="View SR Runtime OHIF SR"][aria-pressed="true"]')
    ),
    createSrDisabled: createButton?.disabled,
    closeSrVisible: !![...document.querySelectorAll('button')].find(
      (button) => button.title === 'Close SR'
    ),
    hideButtonCount: document.querySelectorAll(
      'button[aria-label="Hide measurement"]'
    ).length,
    deleteButtonCount: document.querySelectorAll(
      'button[title="Delete measurement"]'
    ).length,
    lockedVisibilityButtonCount: document.querySelectorAll(
      'button[aria-label="SR measurement — visibility locked"]:disabled'
    ).length,
  };
})()`);
if (
  srViewState.measurementCountText !== 'Measurement (2)' ||
  !srViewState.viewportConnected ||
  srViewState.canvasWidth <= 0 ||
  srViewState.canvasHeight <= 0 ||
  !srViewState.runtimeViewport.currentImageId ||
  srViewState.runtimeViewport.imageIdCount !== totalFrames ||
  srViewState.runtimeViewport.status.toLowerCase() !== 'rendered' ||
  srViewState.reportMeasurementCount !== 2 ||
  srViewState.renderedReportMeasurementCount < 1 ||
  srViewState.sourceAnnotationRendered ||
  !srViewState.activeReportPressed ||
  !srViewState.createSrDisabled ||
  !srViewState.closeSrVisible ||
  srViewState.hideButtonCount !== 0 ||
  srViewState.deleteButtonCount !== 0 ||
  srViewState.lockedVisibilityButtonCount !== 2
) {
  throw new Error(`Invalid active SR state: ${JSON.stringify(srViewState)}`);
}
await evaluate(
  `[...document.querySelectorAll('button')].find((button) => button.title === 'Close SR')?.click()`
);
await waitFor(
  `![...document.querySelectorAll('button')].some((button) => button.title === 'Close SR')`
);
const reportAnnotationUIDsExpression = JSON.stringify(
  srViewState.reportAnnotationUIDs
);
await waitFor(`(() => {
  const reportUIDs = new Set(${reportAnnotationUIDsExpression});
  return ![...document.querySelectorAll(
    '#svg-layer-WORKSTATION_VIEWPORT [data-annotation-uid]'
  )].some((node) => reportUIDs.has(node.getAttribute('data-annotation-uid')));
})()`);

// Re-open and close the same secondary display set once more. This catches
// stale View/Close jobs that used to detach the primary image viewport.
await clickElement(
  `document.querySelector('button[aria-label="View SR Runtime OHIF SR"]')`
);
await waitFor(
  `!![...document.querySelectorAll('button')].find((button) => button.title === 'Close SR')`
);
await waitFor(`(() => {
  const reportUIDs = new Set(${reportAnnotationUIDsExpression});
  return [...document.querySelectorAll(
    '#svg-layer-WORKSTATION_VIEWPORT [data-annotation-uid]'
  )].some((node) => reportUIDs.has(node.getAttribute('data-annotation-uid')));
})()`);
await waitFor(`(() => {
  const viewport = document.querySelector(
    '[data-viewport-uid="WORKSTATION_VIEWPORT"]'
  );
  const rect = viewport?.querySelector(
    'canvas.cornerstone-canvas'
  )?.getBoundingClientRect();
  return Boolean(rect && rect.width > 0 && rect.height > 0);
})()`);
await clickElement(
  `[...document.querySelectorAll('button')].find((button) => button.title === 'Close SR')`
);
await waitFor(
  `![...document.querySelectorAll('button')].some((button) => button.title === 'Close SR')`
);
await waitFor(`(() => {
  const reportUIDs = new Set(${reportAnnotationUIDsExpression});
  return ![...document.querySelectorAll(
    '#svg-layer-WORKSTATION_VIEWPORT [data-annotation-uid]'
  )].some((node) => reportUIDs.has(node.getAttribute('data-annotation-uid')));
})()`);
await new Promise((resolve) => setTimeout(resolve, 750));
await clickElement(
  `document.querySelector(
    '[data-annotation-uid=${JSON.stringify(sourceAnnotationUID)}] button[aria-label="Show measurement"]'
  )`
);
await waitFor(
  `!!document.querySelector('button[aria-label="Hide measurement"]')`
);
await waitFor(isSourceAnnotationRendered);
const sourceStateAfterClose = await evaluate(`(() => {
  const viewport = document.querySelector(
    '[data-viewport-uid="WORKSTATION_VIEWPORT"]'
  );
  return {
    viewportText: viewport?.innerText ?? '',
    canvasCount: viewport?.querySelectorAll('canvas.cornerstone-canvas').length ?? 0,
    measurementCountText: document.body.innerText.match(/Measurement \\(\\d+\\)/)?.[0],
  };
})()`);
if (
  sourceStateAfterClose.measurementCountText !== 'Measurement (2)' ||
  sourceStateAfterClose.canvasCount < 1
) {
  throw new Error(
    `Invalid source state after closing SR: ${JSON.stringify(
      sourceStateAfterClose
    )}`
  );
}

// A second export must snapshot only the two editable source measurements,
// not the two hydrated annotations from the first report.
await createSrReport('Runtime OHIF SR 2');
await waitFor(
  `document.querySelectorAll('button[aria-label^="View SR Runtime OHIF SR"]').length === 2`
);
await waitFor(`document.body.innerText.includes('Measurement (2)')`);

await clickElement(
  `document.querySelector('button[aria-label="View SR Runtime OHIF SR 2"]')`
);
await waitFor(
  `[...document.querySelectorAll('button')].some(
    (button) => button.title === 'Close SR'
  )`
);
await waitFor(`document.body.innerText.includes('Measurement (2)')`);
await waitFor(`(() => {
  const viewport = document.querySelector(
    '[data-viewport-uid="WORKSTATION_VIEWPORT"]'
  );
  const rect = viewport?.querySelector(
    'canvas.cornerstone-canvas'
  )?.getBoundingClientRect();
  return Boolean(rect && rect.width > 0 && rect.height > 0);
})()`);
await clickElement(
  `[...document.querySelectorAll('button')].find(
    (button) => button.title === 'Close SR'
  )`
);
await waitFor(
  `![...document.querySelectorAll('button')].some(
    (button) => button.title === 'Close SR'
  )`
);
await waitFor(`document.body.innerText.includes('Measurement (2)')`);

await clickElement(
  `document.querySelector(
    '[data-annotation-uid=${JSON.stringify(sourceAnnotationUID)}] button[title="Delete measurement"]'
  )`
);
await waitFor(`document.body.innerText.includes('Measurement (1)')`);
await new Promise((resolve) => setTimeout(resolve, 450));
await clickElement(
  `document.querySelector('button[title="Delete measurement"]:not(:disabled)')`
);
await waitFor(
  `document.body.innerText.includes('Measurement (0)')`
);
const afterDeleteState = await evaluate(`(() => {
  const createButton = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Create SR'
  );
  return {
    measurementCountText:
      document.body.innerText.match(/Measurement \\(\\d+\\)/)?.[0],
    createSrDisabled: createButton?.disabled,
    deleteButtonCount: document.querySelectorAll(
      'button[title="Delete measurement"]'
    ).length,
  };
})()`);
if (
  afterDeleteState.measurementCountText !== 'Measurement (0)' ||
  !afterDeleteState.createSrDisabled ||
  afterDeleteState.deleteButtonCount !== 0
) {
  throw new Error(
    `Invalid measurement state after delete: ${JSON.stringify(
      afterDeleteState
    )}`
  );
}

const snapshot = await evaluate(`(() => ({
  title: document.title,
  buttons: [...document.querySelectorAll('button')].map((button) => ({
    text: button.textContent?.trim(),
    aria: button.getAttribute('aria-label'),
    title: button.getAttribute('title'),
    disabled: button.disabled,
  })),
  menuItems: [...document.querySelectorAll('[role="menuitem"]')].map((item) => ({
    text: item.textContent?.trim(),
    ariaDisabled: item.getAttribute('aria-disabled'),
  })),
  viewport: (() => {
    const element =
      document.querySelector('[data-viewport-uid]') ??
      document.querySelector('.cornerstone-canvas')?.parentElement ??
      document.querySelector('canvas')?.parentElement;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return {
      selectorHint: element.getAttribute('data-viewport-uid'),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  })(),
  text: document.body.innerText.slice(0, 5000),
}))()`);

console.log(JSON.stringify(snapshot, null, 2));
console.log(
  JSON.stringify(
    {
      sourceStateAfterExport,
      srViewState,
      sourceStateAfterClose,
      afterDeleteState,
    },
    null,
    2
  )
);

const runtimeErrors = events
  .filter(
    (event) =>
      event.method === 'Runtime.exceptionThrown' ||
      (event.method === 'Log.entryAdded' &&
        event.params?.entry?.level === 'error')
  )
  .map((event) => event.params);
console.log(
  JSON.stringify({ runtimeErrorCount: runtimeErrors.length, runtimeErrors }, null, 2)
);
if (runtimeErrors.length) {
  throw new Error(
    `Viewer emitted ${runtimeErrors.length} runtime error(s).`
  );
}

const downloadStartedAt = Date.now();
let downloadedFiles = [];
while (downloadedFiles.length < 2 && Date.now() - downloadStartedAt < 15000) {
  downloadedFiles = fs
    .readdirSync(downloadPath)
    .filter((name) => name.endsWith('.dcm'))
    .map((name) => ({
      name,
      path: path.join(downloadPath, name),
      modifiedAt: fs.statSync(path.join(downloadPath, name)).mtimeMs,
    }))
    .sort((a, b) => b.modifiedAt - a.modifiedAt);
  if (downloadedFiles.length < 2) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
if (downloadedFiles.length !== 2) {
  throw new Error(
    `Expected two DICOM SR downloads, received ${downloadedFiles.length}.`
  );
}
const downloadedFile = downloadedFiles[0];

const dcmjsModule = await import('dcmjs');
const dcmjs = dcmjsModule.default ?? dcmjsModule;
const fileBuffer = fs.readFileSync(downloadedFile.path);
const arrayBuffer = fileBuffer.buffer.slice(
  fileBuffer.byteOffset,
  fileBuffer.byteOffset + fileBuffer.byteLength
);
const dicomFile = dcmjs.data.DicomMessage.readFile(arrayBuffer);
const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
  dicomFile.dict
);
function toArray(value) {
  return Array.isArray(value) ? value : value ? [value] : [];
}
function codeMeaning(item) {
  return toArray(item?.ConceptNameCodeSequence)[0]?.CodeMeaning;
}
const imagingMeasurements = toArray(dataset.ContentSequence).find(
  (item) => codeMeaning(item) === 'Imaging Measurements'
);
const measurementGroups = toArray(
  imagingMeasurements?.ContentSequence
).filter((item) => codeMeaning(item) === 'Measurement Group');

console.log(
  JSON.stringify(
    {
      downloadedFile: downloadedFile.path,
      size: fileBuffer.byteLength,
      dicmPrefix: fileBuffer.subarray(128, 132).toString('ascii'),
      sopClassUID: dataset.SOPClassUID,
      sopInstanceUID: dataset.SOPInstanceUID,
      seriesInstanceUID: dataset.SeriesInstanceUID,
      studyInstanceUID: dataset.StudyInstanceUID,
      templateIdentifier: dataset.ContentTemplateSequence?.TemplateIdentifier,
      measurementGroupCount: measurementGroups.length,
      patientID: dataset.PatientID,
      patientName: dataset.PatientName,
      seriesNumber: dataset.SeriesNumber,
      seriesDescription: dataset.SeriesDescription,
    },
    null,
    2
  )
);

if (fileBuffer.subarray(128, 132).toString('ascii') !== 'DICM') {
  throw new Error('Downloaded file is not a DICOM Part 10 file.');
}
if (dataset.StudyInstanceUID !== studyUID) {
  throw new Error('Downloaded SR references the wrong study.');
}
if (String(dataset.ContentTemplateSequence?.TemplateIdentifier) !== '1500') {
  throw new Error('Downloaded SR is not TID 1500.');
}
if (measurementGroups.length !== 2) {
  throw new Error('Downloaded SR does not contain exactly two measurements.');
}
if (String(dataset.SeriesNumber) !== '3002') {
  throw new Error(
    `The second SR should use SeriesNumber 3002, received ${dataset.SeriesNumber}.`
  );
}

await send('Target.closeTarget', { targetId });
await send('Target.disposeBrowserContext', { browserContextId });
ws.close();

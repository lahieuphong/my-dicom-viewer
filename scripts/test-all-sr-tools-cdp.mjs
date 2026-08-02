import fs from 'node:fs';
import path from 'node:path';

const studyUID =
  '1.3.6.1.4.1.14519.5.2.1.1188.4001.866856253970500879015300047605';
const cdpOrigin =
  process.env.CDP_ORIGIN ?? 'http://127.0.0.1:9222';
const viewerOrigin =
  process.env.VIEWER_ORIGIN ?? 'http://127.0.0.1:3000';
const reportName = `All SR Tools ${Date.now()}`;
const testGhostCancellation =
  process.env.SR_TEST_GHOST_CANCELLATION === '1';
const singleToolName = process.env.SR_SINGLE_TOOL?.trim() || null;
const downloadPath = `/tmp/dicom-sr-tools-${Date.now()}`;
fs.mkdirSync(downloadPath, { recursive: true });

const version = await fetch(`${cdpOrigin}/json/version`).then((r) =>
  r.json()
);
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let commandId = 0;
let pageSessionId;
const pending = new Map();
const runtimeErrors = [];
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id) {
    const handler = pending.get(message.id);
    if (!handler) return;
    pending.delete(message.id);
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
  if (
    message.method === 'Page.javascriptDialogOpening' &&
    pageSessionId
  ) {
    void send(
      'Page.handleJavaScriptDialog',
      { accept: true, promptText: 'Arrow SR annotation' },
      pageSessionId
    );
  }
});

function send(method, params = {}, sessionId) {
  const id = ++commandId;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  socket.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

const { browserContextId } = await send('Target.createBrowserContext', {
  disposeOnDetach: true,
});
const { targetId } = await send('Target.createTarget', {
  url: `${viewerOrigin}/viewer?StudyInstanceUIDs=${studyUID}`,
  browserContextId,
});
const attached = await send('Target.attachToTarget', {
  targetId,
  flatten: true,
});
pageSessionId = attached.sessionId;
await Promise.all([
  send('Page.enable', {}, pageSessionId),
  send('Runtime.enable', {}, pageSessionId),
  send('Log.enable', {}, pageSessionId),
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
  pageSessionId
);

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

async function waitFor(expression, timeout = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const diagnostic = await evaluate(
    `document.body.innerText.slice(-5000)`
  );
  throw new Error(`Timeout: ${expression}\n${diagnostic}`);
}

async function center(expression) {
  const result = await evaluate(`(() => {
    const element = ${expression};
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!result) throw new Error(`Missing element: ${expression}`);
  return result;
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

async function pointerClick(point, clickCount = 1) {
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
      clickCount,
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
      clickCount,
    },
    pageSessionId
  );
}

async function pointerDrag(start, end) {
  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', ...start },
    pageSessionId
  );
  await send(
    'Input.dispatchMouseEvent',
    {
      type: 'mousePressed',
      ...start,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    },
    pageSessionId
  );
  await send(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseMoved',
      ...end,
      button: 'left',
      buttons: 1,
    },
    pageSessionId
  );
  await send(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseReleased',
      ...end,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    },
    pageSessionId
  );
}

async function pointerPath(points) {
  if (points.length < 2) {
    throw new Error('pointerPath requires at least two points.');
  }

  await send(
    'Input.dispatchMouseEvent',
    { type: 'mouseMoved', ...points[0] },
    pageSessionId
  );
  await send(
    'Input.dispatchMouseEvent',
    {
      type: 'mousePressed',
      ...points[0],
      button: 'left',
      buttons: 1,
      clickCount: 1,
    },
    pageSessionId
  );
  for (const pathPoint of points.slice(1)) {
    await send(
      'Input.dispatchMouseEvent',
      {
        type: 'mouseMoved',
        ...pathPoint,
        button: 'left',
        buttons: 1,
      },
      pageSessionId
    );
  }
  await send(
    'Input.dispatchMouseEvent',
    {
      type: 'mouseReleased',
      ...points.at(-1),
      button: 'left',
      buttons: 0,
      clickCount: 1,
    },
    pageSessionId
  );
}

async function selectMeasurementTool(toolId) {
  await clickElement(
    `document.querySelector('[data-testid="measurement-tools-menu-trigger"]')`
  );
  await waitFor(
    `!!document.querySelector(
      '[role="menuitem"][data-tool-id="${toolId}"]'
    )`
  );
  await clickElement(
    `document.querySelector(
      '[role="menuitem"][data-tool-id="${toolId}"]'
    )`
  );
  await waitFor(
    `!document.querySelector(
      '[role="menuitem"][data-tool-id="${toolId}"]'
    )`
  );
}

async function selectAngleTool() {
  await clickElement(
    `[...document.querySelectorAll(
      '[role="toolbar"] button[aria-haspopup="menu"]'
    )][1]`
  );
  await waitFor(
    `[...document.querySelectorAll('[role="menuitem"]')].some(
      (item) => item.textContent?.trim() === 'Angle'
    )`
  );
  await clickElement(
    `[...document.querySelectorAll('[role="menuitem"]')].find(
      (candidate) => candidate.textContent?.trim() === 'Angle'
    )`
  );
  await waitFor(
    `![...document.querySelectorAll('[role="menuitem"]')].some(
      (item) => item.textContent?.trim() === 'Angle'
    )`
  );
}

async function waitForMeasurementCount(count) {
  await waitFor(`document.body.innerText.includes('Measurement (${count})')`);
}

function annotationRenderedExpression(annotationUID) {
  return `(() =>
    [...document.querySelectorAll(
      '#svg-layer-WORKSTATION_VIEWPORT [data-annotation-uid]'
    )].some(
      (node) => node.getAttribute('data-annotation-uid') ===
        ${JSON.stringify(annotationUID)}
    )
  )()`;
}

await waitFor(
  `document.readyState === 'complete' &&
    !!document.querySelector('[data-viewport-uid="WORKSTATION_VIEWPORT"]') &&
    !!document.querySelector('canvas') &&
    !!document.querySelector('[data-testid="measurement-tools-control"]')`,
  45000
);
await new Promise((resolve) => setTimeout(resolve, 5000));
const viewport = await evaluate(`(() => {
  const rect = document.querySelector(
    '[data-viewport-uid="WORKSTATION_VIEWPORT"]'
  ).getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
})()`);
const point = (x, y) => ({
  x: viewport.x + viewport.width * x,
  y: viewport.y + viewport.height * y,
});

await clickElement(
  `document.querySelector('[data-testid="measurement-tools-menu-trigger"]')`
);
await waitFor(
  `!!document.querySelector('[data-testid="measurement-tools-menu"]')`
);
// Radix applies a short zoom-in animation to the menu. Measure the final
// rendered geometry instead of the transient 95% animation frame.
await new Promise((resolve) => setTimeout(resolve, 250));
const measurementMenuState = await evaluate(`(() => {
  const control = document.querySelector(
    '[data-testid="measurement-tools-control"]'
  );
  const menu = document.querySelector(
    '[data-testid="measurement-tools-menu"]'
  );
  const label = menu?.querySelector('[data-slot="dropdown-menu-label"]');
  const primary = control?.querySelector('button[data-tool-id]');
  const trigger = control?.querySelector(
    '[data-testid="measurement-tools-menu-trigger"]'
  );
  const items = [...document.querySelectorAll(
    '[data-testid="measurement-tools-menu"] [role="menuitem"]'
  )];
  const visualStyle = (element) => {
    if (!element) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      paddingTop: style.paddingTop,
      paddingRight: style.paddingRight,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
    };
  };
  return {
    ids: items.map((item) => item.getAttribute('data-tool-id')),
    labels: items.map((item) => item.textContent?.trim()),
    header: label?.textContent?.trim() ?? null,
    fontSizes: items.map((item) => getComputedStyle(item).fontSize),
    iconSizes: items.map((item) => {
      const rect = item.querySelector('svg')?.getBoundingClientRect();
      return rect ? [Math.round(rect.width), Math.round(rect.height)] : null;
    }),
    controlVisual: visualStyle(control),
    menuVisual: visualStyle(menu),
    labelVisual: visualStyle(label),
    itemVisual: visualStyle(items[0]),
    primaryIconSize: (() => {
      const rect = primary?.querySelector('svg')?.getBoundingClientRect();
      return rect ? [Math.round(rect.width), Math.round(rect.height)] : null;
    })(),
    triggerSize: trigger
      ? [Math.round(trigger.getBoundingClientRect().width), Math.round(trigger.getBoundingClientRect().height)]
      : null,
  };
})()`);
const expectedMeasurementMenuIds = [
  'length',
  'bidirectional',
  'arrowAnnotate',
  'ellipticalROI',
  'rectangleROI',
  'circleROI',
  'planarFreehandROI',
  'splineROI',
  'livewireContour',
];
const expectedMeasurementMenuLabels = [
  'Thước đo chiều dài',
  'Hai hướng',
  'Annotation',
  'Đo Elip',
  'Đo chữ nhật',
  'Vòng tròn',
  'Freehand ROI',
  'Spline ROI',
  'Livewire tool',
];
if (
  JSON.stringify(measurementMenuState.ids) !==
    JSON.stringify(expectedMeasurementMenuIds) ||
  JSON.stringify(measurementMenuState.labels) !==
    JSON.stringify(expectedMeasurementMenuLabels) ||
  measurementMenuState.header !== 'Measurement' ||
  measurementMenuState.iconSizes.some(
    (size) => !size || size[0] !== 16 || size[1] !== 16
  ) ||
  measurementMenuState.primaryIconSize?.some((size) => size !== 16) ||
  measurementMenuState.triggerSize?.[0] !== 20 ||
  measurementMenuState.controlVisual?.width !== 56 ||
  measurementMenuState.controlVisual?.height !== 36
) {
  throw new Error(
    `Measurement menu content changed unexpectedly: ${JSON.stringify(
      measurementMenuState
    )}`
  );
}
const menuScreenshot = await send(
  'Page.captureScreenshot',
  { format: 'png', fromSurface: true },
  pageSessionId
);
const menuScreenshotPath = path.join(
  downloadPath,
  'measurement-menu-other-style.png'
);
fs.writeFileSync(
  menuScreenshotPath,
  Buffer.from(menuScreenshot.data, 'base64')
);
await clickElement(
  `document.querySelector('[data-testid="measurement-tools-menu-trigger"]')`
);
await waitFor(
  `!document.querySelector('[data-testid="measurement-tools-menu"]')`
);

await clickElement(
  `[...document.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label')?.startsWith('Công cụ khác —')
  )`
);
await waitFor(
  `[...document.querySelectorAll('[data-slot="dropdown-menu-label"]')].some(
    (label) => label.textContent?.trim() === 'Other'
  )`
);
await new Promise((resolve) => setTimeout(resolve, 250));
const otherMenuStyle = await evaluate(`(() => {
  const label = [...document.querySelectorAll(
    '[data-slot="dropdown-menu-label"]'
  )].find((candidate) => candidate.textContent?.trim() === 'Other');
  const menu = label?.closest('[data-slot="dropdown-menu-content"]');
  const item = menu?.querySelector('[role="menuitem"]');
  const trigger = [...document.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label')?.startsWith('Công cụ khác —')
  );
  const visualStyle = (element) => {
    if (!element) return null;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      backgroundColor: style.backgroundColor,
      color: style.color,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      paddingTop: style.paddingTop,
      paddingRight: style.paddingRight,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
    };
  };
  return {
    controlVisual: visualStyle(trigger),
    menuVisual: visualStyle(menu),
    labelVisual: visualStyle(label),
    itemVisual: visualStyle(item),
  };
})()`);
const comparableControlStyle = (style) => ({
  width: style?.width,
  height: style?.height,
  backgroundColor: style?.backgroundColor,
  color: style?.color,
  borderColor: style?.borderColor,
  borderRadius: style?.borderRadius,
});
const comparableMenuStyle = (style) => ({
  width: style?.width,
  backgroundColor: style?.backgroundColor,
  color: style?.color,
  borderColor: style?.borderColor,
  borderRadius: style?.borderRadius,
  fontSize: style?.fontSize,
  fontWeight: style?.fontWeight,
  lineHeight: style?.lineHeight,
  paddingTop: style?.paddingTop,
  paddingRight: style?.paddingRight,
  paddingBottom: style?.paddingBottom,
  paddingLeft: style?.paddingLeft,
});
if (
  JSON.stringify(comparableMenuStyle(measurementMenuState.menuVisual)) !==
    JSON.stringify(comparableMenuStyle(otherMenuStyle.menuVisual)) ||
  JSON.stringify(measurementMenuState.labelVisual) !==
    JSON.stringify(otherMenuStyle.labelVisual) ||
  JSON.stringify(measurementMenuState.itemVisual) !==
    JSON.stringify(otherMenuStyle.itemVisual) ||
  JSON.stringify(
    comparableControlStyle(measurementMenuState.controlVisual)
  ) !== JSON.stringify(comparableControlStyle(otherMenuStyle.controlVisual)) ||
  measurementMenuState.fontSizes.some(
    (size) => size !== otherMenuStyle.itemVisual?.fontSize
  )
) {
  throw new Error(
    `Measurement menu does not match Other menu styling: ${JSON.stringify({
      measurementMenuState,
      otherMenuStyle,
    })}`
  );
}
await clickElement(
  `[...document.querySelectorAll('button')].find(
    (button) => button.getAttribute('aria-label')?.startsWith('Công cụ khác —')
  )`
);
await waitFor(
  `![...document.querySelectorAll('[data-slot="dropdown-menu-label"]')].some(
    (label) => label.textContent?.trim() === 'Other'
  )`
);

if (testGhostCancellation) {
  await selectMeasurementTool('splineROI');
  await pointerClick(point(0.40, 0.44));
  await pointerClick(point(0.46, 0.37));
  await pointerClick(point(0.54, 0.42));
  await new Promise((resolve) => setTimeout(resolve, 350));
  const draftState = await evaluate(`(() => {
    const createButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Create SR'
    );
    return {
      measurementCount:
        document.body.innerText.match(/Measurement \\(\\d+\\)/)?.[0],
      createSrDisabled: createButton?.disabled,
      measurementCardCount: document.querySelectorAll(
        '[aria-label^="Measurement #"]'
      ).length,
    };
  })()`);
  if (
    draftState.measurementCount !== 'Measurement (0)' ||
    draftState.createSrDisabled !== true ||
    draftState.measurementCardCount !== 0
  ) {
    throw new Error(
      `Draft annotation leaked into Measurement state: ${JSON.stringify(
        draftState
      )}`
    );
  }
  await send(
    'Input.dispatchKeyEvent',
    {
      type: 'rawKeyDown',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
    },
    pageSessionId
  );
  await send(
    'Input.dispatchKeyEvent',
    {
      type: 'keyUp',
      key: 'Backspace',
      code: 'Backspace',
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
    },
    pageSessionId
  );
  await waitForMeasurementCount(0);

  const state = await evaluate(`(() => {
    const createButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Create SR'
    );
    return {
      measurementCount:
        document.body.innerText.match(/Measurement \\(\\d+\\)/)?.[0],
      createSrDisabled: createButton?.disabled,
      measurementCardCount: document.querySelectorAll(
        '[aria-label^="Measurement #"]'
      ).length,
    };
  })()`);
  if (
    state.measurementCount !== 'Measurement (0)' ||
    state.createSrDisabled !== true ||
    state.measurementCardCount !== 0
  ) {
    throw new Error(
      `Cancelled annotation left a ghost measurement: ${JSON.stringify(
        state
      )}`
    );
  }
  console.log(
    JSON.stringify(
      { draftAnnotation: draftState, ghostCancellation: state },
      null,
      2
    )
  );
  await send('Target.closeTarget', { targetId });
  await send('Target.disposeBrowserContext', { browserContextId });
  socket.close();
  process.exit(0);
}

const dragTools = [
  ['length', point(0.34, 0.35), point(0.48, 0.42)],
  ['bidirectional', point(0.48, 0.34), point(0.64, 0.43)],
  ['arrowAnnotate', point(0.37, 0.52), point(0.48, 0.58)],
  ['ellipticalROI', point(0.52, 0.50), point(0.65, 0.62)],
  ['rectangleROI', point(0.31, 0.64), point(0.43, 0.75)],
  ['circleROI', point(0.55, 0.66), point(0.64, 0.76)],
];

let measurementCount = 0;
let singleContourAnnotationUID = null;
let contourInteractionState = null;
let srHydrationState = null;
let afterDeleteState = null;
for (const [toolName, start, end] of dragTools) {
  if (singleToolName && singleToolName !== toolName) continue;
  await selectMeasurementTool(toolName);
  await pointerDrag(start, end);
  measurementCount += 1;
  await waitForMeasurementCount(measurementCount);
}

if (!singleToolName || singleToolName === 'planarFreehandROI') {
  await selectMeasurementTool('planarFreehandROI');
  await pointerPath([
    point(0.42, 0.65),
    point(0.45, 0.61),
    point(0.50, 0.60),
    point(0.54, 0.63),
    point(0.55, 0.68),
    point(0.52, 0.72),
    point(0.47, 0.73),
    point(0.43, 0.70),
    point(0.42, 0.65),
  ]);
  measurementCount += 1;
  await waitForMeasurementCount(measurementCount);
}

if (!singleToolName || singleToolName === 'splineROI') {
  await selectMeasurementTool('splineROI');
  await pointerClick(point(0.40, 0.44));
  await pointerClick(point(0.46, 0.37));
  await pointerClick(point(0.54, 0.42));
  await pointerClick(point(0.52, 0.51));
  await pointerClick(point(0.40, 0.44), 2);
  measurementCount += 1;
  await waitForMeasurementCount(measurementCount);
}

if (!singleToolName || singleToolName === 'livewireContour') {
  await selectMeasurementTool('livewireContour');
  await pointerClick(point(0.58, 0.46));
  await pointerClick(point(0.66, 0.47));
  await pointerClick(point(0.68, 0.56));
  await pointerClick(point(0.61, 0.59));
  await pointerClick(point(0.58, 0.46), 2);
  measurementCount += 1;
  await waitForMeasurementCount(measurementCount);
}

if (!singleToolName || singleToolName === 'angle') {
  await selectAngleTool();
  await pointerDrag(point(0.67, 0.38), point(0.72, 0.48));
  await pointerDrag(point(0.72, 0.48), point(0.66, 0.58));
  measurementCount += 1;
  await waitForMeasurementCount(measurementCount);
}

if (!measurementCount) {
  throw new Error(`Unsupported SR_SINGLE_TOOL value: ${singleToolName}`);
}

if (
  singleToolName === 'planarFreehandROI' ||
  singleToolName === 'livewireContour'
) {
  singleContourAnnotationUID = await evaluate(`(() => {
    const cards = [...document.querySelectorAll(
      '[role="button"][data-annotation-uid]'
    )];
    return cards.length === 1
      ? cards[0].getAttribute('data-annotation-uid')
      : null;
  })()`);
  if (!singleContourAnnotationUID) {
    throw new Error('Could not resolve the contour measurement card.');
  }

  const isContourRendered = annotationRenderedExpression(
    singleContourAnnotationUID
  );
  await waitFor(isContourRendered);
  await clickElement(
    `document.querySelector(
      '[data-annotation-uid=${JSON.stringify(
        singleContourAnnotationUID
      )}] button[aria-label="Hide measurement"]'
    )`
  );
  await waitFor(
    `!!document.querySelector(
      '[data-annotation-uid=${JSON.stringify(
        singleContourAnnotationUID
      )}] button[aria-label="Show measurement"]'
    )`
  );
  await waitFor(`!(${isContourRendered})`);
  await clickElement(
    `document.querySelector(
      '[data-annotation-uid=${JSON.stringify(
        singleContourAnnotationUID
      )}] button[aria-label="Show measurement"]'
    )`
  );
  await waitFor(isContourRendered);
  contourInteractionState = await evaluate(`({
    annotationUID: ${JSON.stringify(singleContourAnnotationUID)},
    renderedAfterShow: ${isContourRendered},
    hideButtonVisible: !!document.querySelector(
      '[data-annotation-uid=${JSON.stringify(
        singleContourAnnotationUID
      )}] button[aria-label="Hide measurement"]'
    ),
  })`);
  if (
    !contourInteractionState.renderedAfterShow ||
    !contourInteractionState.hideButtonVisible
  ) {
    throw new Error(
      `Invalid contour hide/show state: ${JSON.stringify(
        contourInteractionState
      )}`
    );
  }
}

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
  setter.call(input, ${JSON.stringify(reportName)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await clickElement(
  `[...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Tạo SR'
  )`
);
await waitFor(
  `document.body.innerText.includes('Đã tạo và tải xuống DICOM SR.') ||
    !!document.querySelector('[data-sonner-toast][data-type="error"]')`,
  60000
);
const exportOutcome = await evaluate(`({
  succeeded: document.body.innerText.includes(
    'Đã tạo và tải xuống DICOM SR.'
  ),
  error: document.querySelector(
    '[data-sonner-toast][data-type="error"]'
  )?.textContent?.trim() ?? null,
})`);
if (!exportOutcome.succeeded) {
  throw new Error(
    `DICOM SR export failed: ${exportOutcome.error ?? 'unknown error'}`
  );
}
await waitForMeasurementCount(measurementCount);

const uiState = await evaluate(`({
  measurementCount: document.body.innerText.match(/Measurement \\(\\d+\\)/)?.[0],
  reportVisible: [...document.querySelectorAll('[title]')].some(
    (node) => node.getAttribute('title') === ${JSON.stringify(reportName)}
  ),
  dialogOpen: !!document.querySelector('[role="dialog"]'),
})`);

const downloadStartedAt = Date.now();
let downloadedFile;
while (Date.now() - downloadStartedAt < 15000) {
  downloadedFile = fs
    .readdirSync(downloadPath)
    .find((name) => name.endsWith('.dcm'));
  if (downloadedFile) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!downloadedFile) throw new Error('All-tools DICOM SR was not downloaded.');

const dcmjsModule = await import('dcmjs');
const dcmjs = dcmjsModule.default ?? dcmjsModule;
const fileBuffer = fs.readFileSync(path.join(downloadPath, downloadedFile));
const arrayBuffer = fileBuffer.buffer.slice(
  fileBuffer.byteOffset,
  fileBuffer.byteOffset + fileBuffer.byteLength
);
const dicomFile = dcmjs.data.DicomMessage.readFile(arrayBuffer);
const dataset = dcmjs.data.DicomMetaDictionary.naturalizeDataset(
  dicomFile.dict
);
const asArray = (value) =>
  Array.isArray(value) ? value : value ? [value] : [];
const codeMeaning = (item) =>
  asArray(item?.ConceptNameCodeSequence)[0]?.CodeMeaning;
const imagingMeasurements = asArray(dataset.ContentSequence).find(
  (item) => codeMeaning(item) === 'Imaging Measurements'
);
const groups = asArray(imagingMeasurements?.ContentSequence).filter(
  (item) => codeMeaning(item) === 'Measurement Group'
);
const groupSummaries = groups.map((group) => {
  const content = asArray(group.ContentSequence);
  const tracking = content.find(
    (item) => codeMeaning(item) === 'Tracking Identifier'
  )?.TextValue;
  const nums = content
    .filter((item) => item.ValueType === 'NUM')
    .map((item) => ({
      concept: codeMeaning(item),
      value: asArray(item.MeasuredValueSequence)[0]?.NumericValue,
      unit: asArray(
        asArray(item.MeasuredValueSequence)[0]
          ?.MeasurementUnitsCodeSequence
      )[0]?.CodeValue,
    }));
  const point = content.find(
    (item) =>
      item.ValueType === 'SCOORD' &&
      codeMeaning(item) === 'Center'
  );
  return {
    tracking,
    nums,
    pointGraphicType: point?.GraphicType,
    pointGraphicDataLength: point?.GraphicData?.length,
  };
});

for (const group of groupSummaries) {
  for (const numeric of group.nums) {
    if (!Number.isFinite(Number(numeric.value)) || !numeric.unit) {
      throw new Error(
        `Invalid NUM content: ${JSON.stringify({ group, numeric })}`
      );
    }
  }
}
const arrowGroup = groupSummaries.find((group) =>
  String(group.tracking).endsWith(':ArrowAnnotate')
);
if (!singleToolName || singleToolName === 'arrowAnnotate') {
  if (
    !arrowGroup ||
    arrowGroup.pointGraphicType !== 'POINT' ||
    arrowGroup.pointGraphicDataLength !== 2
  ) {
    throw new Error(
      `Invalid Arrow SR content: ${JSON.stringify(arrowGroup)}`
    );
  }
}
for (const contourToolName of [
  'PlanarFreehandROI',
  'LivewireContour',
]) {
  const toolId =
    contourToolName === 'PlanarFreehandROI'
      ? 'planarFreehandROI'
      : 'livewireContour';
  if (singleToolName && singleToolName !== toolId) continue;

  const contourGroup = groupSummaries.find((group) =>
    String(group.tracking).endsWith(`:${contourToolName}`)
  );
  if (!contourGroup) {
    throw new Error(`Missing ${contourToolName} DICOM SR group.`);
  }
  if (
    !contourGroup.nums.some(
      (numeric) =>
        numeric.concept === 'Area' && Number(numeric.value) > 0
    )
  ) {
    throw new Error(
      `Invalid ${contourToolName} area: ${JSON.stringify(contourGroup)}`
    );
  }
}
if (groups.length !== measurementCount) {
  throw new Error(
    `All-tools report contains ${groups.length}/${measurementCount} groups.`
  );
}

if (singleContourAnnotationUID) {
  await waitFor(
    `!!document.querySelector(
      'button[aria-label=${JSON.stringify(`View SR ${reportName}`)}]'
    )`,
    60000
  );
  await clickElement(
    `document.querySelector(
      'button[aria-label=${JSON.stringify(`View SR ${reportName}`)}]'
    )`
  );
  await waitFor(
    `!![...document.querySelectorAll('button')].find(
      (button) => button.title === 'Close SR'
    )`,
    60000
  );
  await waitFor(
    `document.querySelectorAll(
      'button[aria-label="SR measurement — visibility locked"]:disabled'
    ).length === 1`
  );
  await waitFor(`(() => {
    const reportUIDs = new Set(
      [...document.querySelectorAll(
        '[role="button"][data-annotation-uid]'
      )]
        .map((card) => card.getAttribute('data-annotation-uid'))
        .filter(Boolean)
    );
    return [...document.querySelectorAll(
      '#svg-layer-WORKSTATION_VIEWPORT [data-annotation-uid]'
    )].some((node) => reportUIDs.has(
      node.getAttribute('data-annotation-uid')
    ));
  })()`, 60000);
  srHydrationState = await evaluate(`(() => {
    const reportUIDs = new Set(
      [...document.querySelectorAll(
        '[role="button"][data-annotation-uid]'
      )]
        .map((card) => card.getAttribute('data-annotation-uid'))
        .filter(Boolean)
    );
    const renderedUIDs = new Set(
      [...document.querySelectorAll(
        '#svg-layer-WORKSTATION_VIEWPORT [data-annotation-uid]'
      )]
        .map((node) => node.getAttribute('data-annotation-uid'))
        .filter((uid) => reportUIDs.has(uid))
    );
    const createButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Create SR'
    );
    return {
      measurementCount:
        document.body.innerText.match(/Measurement \\(\\d+\\)/)?.[0],
      reportMeasurementCount: reportUIDs.size,
      renderedReportMeasurementCount: renderedUIDs.size,
      lockedVisibilityButtonCount: document.querySelectorAll(
        'button[aria-label="SR measurement — visibility locked"]:disabled'
      ).length,
      deleteButtonCount: document.querySelectorAll(
        'button[title="Delete measurement"]'
      ).length,
      activeReportPressed: Boolean(document.querySelector(
        'button[aria-label=${JSON.stringify(`View SR ${reportName}`)}][aria-pressed="true"]'
      )),
      createSrDisabled: createButton?.disabled,
    };
  })()`);
  if (
    srHydrationState.measurementCount !== 'Measurement (1)' ||
    srHydrationState.reportMeasurementCount !== 1 ||
    srHydrationState.renderedReportMeasurementCount !== 1 ||
    srHydrationState.lockedVisibilityButtonCount !== 1 ||
    srHydrationState.deleteButtonCount !== 0 ||
    !srHydrationState.activeReportPressed ||
    !srHydrationState.createSrDisabled
  ) {
    throw new Error(
      `Invalid contour SR hydration state: ${JSON.stringify(
        srHydrationState
      )}`
    );
  }

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
  await waitForMeasurementCount(1);
  await waitFor(annotationRenderedExpression(singleContourAnnotationUID));
  await clickElement(
    `document.querySelector(
      '[data-annotation-uid=${JSON.stringify(
        singleContourAnnotationUID
      )}] button[title="Delete measurement"]'
    )`
  );
  await waitForMeasurementCount(0);
  afterDeleteState = await evaluate(`(() => {
    const createButton = [...document.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Create SR'
    );
    return {
      measurementCount:
        document.body.innerText.match(/Measurement \\(\\d+\\)/)?.[0],
      createSrDisabled: createButton?.disabled,
      deleteButtonCount: document.querySelectorAll(
        'button[title="Delete measurement"]'
      ).length,
      sourceRendered: ${annotationRenderedExpression(
        singleContourAnnotationUID
      )},
    };
  })()`);
  if (
    afterDeleteState.measurementCount !== 'Measurement (0)' ||
    !afterDeleteState.createSrDisabled ||
    afterDeleteState.deleteButtonCount !== 0 ||
    afterDeleteState.sourceRendered
  ) {
    throw new Error(
      `Invalid contour delete state: ${JSON.stringify(afterDeleteState)}`
    );
  }
}

console.log(
  JSON.stringify(
    {
      uiState,
      measurementMenuState,
      contourInteractionState,
      srHydrationState,
      afterDeleteState,
      menuScreenshot: menuScreenshotPath,
      download: path.join(downloadPath, downloadedFile),
      size: fileBuffer.byteLength,
      dicmPrefix: fileBuffer.subarray(128, 132).toString('ascii'),
      studyUID: dataset.StudyInstanceUID,
      template: dataset.ContentTemplateSequence?.TemplateIdentifier,
      measurementCount,
      groups: groupSummaries,
      runtimeErrorCount: runtimeErrors.length,
      runtimeErrors,
    },
    null,
    2
  )
);

await send('Target.closeTarget', { targetId });
await send('Target.disposeBrowserContext', { browserContextId });
socket.close();

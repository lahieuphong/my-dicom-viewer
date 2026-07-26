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
    message.method === 'Log.entryAdded'
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

const { targetId } = await send('Target.createTarget', {
  url: `${viewerOrigin}/viewer?StudyInstanceUIDs=${studyUID}`,
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

async function selectMeasurementTool(toolName) {
  await clickElement(
    `[...document.querySelectorAll(
      '[role="toolbar"] button[aria-haspopup="menu"]'
    )][0]`
  );
  await waitFor(
    `[...document.querySelectorAll('[role="menuitem"]')].some(
      (item) => item.textContent?.trim().toLowerCase() === '${toolName.toLowerCase()}'
    )`
  );
  await clickElement(
    `[...document.querySelectorAll('[role="menuitem"]')].find(
      (candidate) =>
        candidate.textContent?.trim().toLowerCase() ===
        '${toolName.toLowerCase()}'
    )`
  );
  await waitFor(
    `![...document.querySelectorAll('[role="menuitem"]')].some(
      (item) => item.textContent?.trim().toLowerCase() ===
        '${toolName.toLowerCase()}'
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

await waitFor(
  `document.readyState === 'complete' &&
    !!document.querySelector('[data-viewport-uid="WORKSTATION_VIEWPORT"]') &&
    !!document.querySelector('canvas') &&
    !!document.querySelector(
      'button[aria-label="Công cụ đo lường — Measurement Tools"]'
    )`,
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
for (const [toolName, start, end] of dragTools) {
  if (singleToolName && singleToolName !== toolName) continue;
  await selectMeasurementTool(toolName);
  await pointerDrag(start, end);
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

await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === 'Create SR'
  );
  button?.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    pointerId: 9,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
  }));
  button?.click();
})()`);
await waitFor(
  `[...document.querySelectorAll('[role="menuitem"]')].some(
    (item) => item.textContent?.trim() === 'DICOM SR'
  )`
);
await evaluate(`(() => {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim() === 'DICOM SR'
  );
  item?.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerId: 40,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
  }));
  item?.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    pointerId: 40,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 0,
  }));
  item?.click();
})()`);
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
if (groups.length !== measurementCount) {
  throw new Error(
    `All-tools report contains ${groups.length}/${measurementCount} groups.`
  );
}

console.log(
  JSON.stringify(
    {
      uiState,
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
socket.close();

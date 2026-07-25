import fs from 'node:fs';
import path from 'node:path';

const studyUID =
  '1.3.6.1.4.1.14519.5.2.1.1188.4001.866856253970500879015300047605';
const cdpOrigin =
  process.env.CDP_ORIGIN ?? 'http://127.0.0.1:9222';
const viewerOrigin =
  process.env.VIEWER_ORIGIN ?? 'http://127.0.0.1:3000';
const viewerUrl = `${viewerOrigin}/viewer?StudyInstanceUIDs=${studyUID}`;
const downloadPath = '/tmp/dicom-sr-downloads';

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

const { targetId } = await send('Target.createTarget', {
  url: 'about:blank',
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

await send('Page.navigate', { url: viewerUrl }, sessionId);
await waitFor(
  `document.readyState === 'complete' && !!document.querySelector('canvas')`,
  30000
);
await new Promise((resolve) => setTimeout(resolve, 6000));
await evaluate(`(() => {
  const button = document.querySelector(
    'button[aria-label="Công cụ đo lường — Measurement Tools"]'
  );
  button?.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerId: 31,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
  }));
  button?.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    pointerId: 31,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 0,
  }));
})()`);
await waitFor(
  `[...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent?.trim().toLowerCase() === 'length')`
);
await evaluate(`(() => {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim().toLowerCase() === 'length'
  );
  item?.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerId: 32,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
  }));
  item?.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    pointerId: 32,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 0,
  }));
  item?.click();
})()`);

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
await waitFor(`document.body.innerText.includes('Measurement (1)')`);
await waitFor(
  `[...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Create SR' && !button.disabled)`
);
await evaluate(
  `document.querySelector('button[aria-label="Hide measurement"]')?.click()`
);
await waitFor(
  `!!document.querySelector('button[aria-label="Show measurement"]')`
);

await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === 'Create SR'
  );
  button?.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
    })
  );
  button?.click();
})()`);
await waitFor(
  `[...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent?.trim() === 'DICOM SR')`
);
await evaluate(`(() => {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim() === 'DICOM SR'
  );
  item?.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerId: 33,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
  }));
  item?.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    pointerId: 33,
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
  setter.call(input, 'Runtime OHIF SR');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await clickElement(
  `[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Tạo SR')`
);
await waitFor(
  `document.body.innerText.includes('Đã tạo và tải xuống DICOM SR.')`,
  60000
);
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

await evaluate(
  `document.querySelector('span[title="Runtime OHIF SR"]')?.closest('button')?.click()`
);
await waitFor(
  `!![...document.querySelectorAll('button')].find((button) => button.title === 'Close SR')`,
  60000
);
await new Promise((resolve) => setTimeout(resolve, 1000));
const srViewState = await evaluate(`(() => {
  const createButton = [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === 'Create SR'
  );
  return {
    body: document.body.innerText.slice(-2500),
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
  };
})()`);
await evaluate(
  `[...document.querySelectorAll('button')].find((button) => button.title === 'Close SR')?.click()`
);
await waitFor(
  `![...document.querySelectorAll('button')].some((button) => button.title === 'Close SR')`
);
await new Promise((resolve) => setTimeout(resolve, 750));
await evaluate(
  `document.querySelector('button[aria-label="Show measurement"]')?.click()`
);
await waitFor(
  `!!document.querySelector('button[aria-label="Hide measurement"]')`
);
const sourceStateAfterClose = await evaluate(`(() => {
  const viewport = document.querySelector(
    '[data-viewport-uid="WORKSTATION_VIEWPORT"]'
  );
  return {
    viewportText: viewport?.innerText ?? '',
    measurementCountText: document.body.innerText.match(/Measurement \\(\\d+\\)/)?.[0],
  };
})()`);

await evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === 'Create SR'
  );
  button?.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 2,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
    })
  );
  button?.click();
})()`);
await waitFor(
  `[...document.querySelectorAll('[role="menuitem"]')].some((item) => item.textContent?.trim() === 'JSON SR')`
);
await evaluate(
  `[...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent?.trim() === 'JSON SR')?.click()`
);
await waitFor(`!!document.querySelector('input[aria-label="Tên SR"]')`);
await evaluate(`(() => {
  const input = document.querySelector('input[aria-label="Tên SR"]');
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value'
  ).set;
  setter.call(input, 'Runtime OHIF JSON');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`);
await clickElement(
  `[...document.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Tạo SR')`
);
await waitFor(
  `document.body.innerText.includes('Đã tạo và tải xuống DICOM JSON SR.')`,
  60000
);
await new Promise((resolve) => setTimeout(resolve, 1000));
const jsonExportState = await evaluate(`({
  measurementCountText: document.body.innerText.match(/Measurement \\(\\d+\\)/)?.[0],
  reportCount: [...document.querySelectorAll('span[title]')].filter(
    (span) => ['Runtime OHIF SR', 'Runtime OHIF JSON'].includes(
      span.getAttribute('title')
    )
  ).length,
})`);
await evaluate(
  `document.querySelector('button[title="Delete measurement"]')?.click()`
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
      jsonExportState,
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
      event.method === 'Log.entryAdded'
  )
  .map((event) => event.params);
console.log(
  JSON.stringify({ runtimeErrorCount: runtimeErrors.length, runtimeErrors }, null, 2)
);

await send('Target.closeTarget', { targetId });
ws.close();

const downloadedFile = fs
  .readdirSync(downloadPath)
  .filter((name) => name.endsWith('.dcm'))
  .map((name) => ({
    name,
    path: path.join(downloadPath, name),
    modifiedAt: fs.statSync(path.join(downloadPath, name)).mtimeMs,
  }))
  .sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
if (!downloadedFile) throw new Error('No DICOM SR file was downloaded.');

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
if (measurementGroups.length !== 1) {
  throw new Error('Downloaded SR does not contain exactly one measurement.');
}

const downloadedJson = fs
  .readdirSync(downloadPath)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({
    name,
    path: path.join(downloadPath, name),
    modifiedAt: fs.statSync(path.join(downloadPath, name)).mtimeMs,
  }))
  .sort((a, b) => b.modifiedAt - a.modifiedAt)[0];
if (!downloadedJson) throw new Error('No DICOM JSON SR file was downloaded.');

const dicomJson = JSON.parse(fs.readFileSync(downloadedJson.path, 'utf8'));
const jsonDataset =
  dcmjs.data.DicomMetaDictionary.naturalizeDataset(dicomJson);
const jsonImagingMeasurements = toArray(
  jsonDataset.ContentSequence
).find((item) => codeMeaning(item) === 'Imaging Measurements');
const jsonMeasurementGroups = toArray(
  jsonImagingMeasurements?.ContentSequence
).filter((item) => codeMeaning(item) === 'Measurement Group');
console.log(
  JSON.stringify(
    {
      downloadedJson: downloadedJson.path,
      studyInstanceUID: jsonDataset.StudyInstanceUID,
      sopClassUID: jsonDataset.SOPClassUID,
      templateIdentifier:
        jsonDataset.ContentTemplateSequence?.TemplateIdentifier,
      measurementGroupCount: jsonMeasurementGroups.length,
      seriesDescription: jsonDataset.SeriesDescription,
    },
    null,
    2
  )
);
if (
  jsonDataset.StudyInstanceUID !== studyUID ||
  String(jsonDataset.ContentTemplateSequence?.TemplateIdentifier) !==
    '1500' ||
  jsonMeasurementGroups.length !== 1
) {
  throw new Error('Downloaded DICOM JSON SR failed validation.');
}

const studyUID =
  '1.3.6.1.4.1.14519.5.2.1.1188.4001.866856253970500879015300047605';
const version = await fetch('http://127.0.0.1:9222/json/version').then((r) =>
  r.json()
);
const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let commandId = 0;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  const handler = pending.get(message.id);
  if (!handler) return;
  pending.delete(message.id);
  if (message.error) handler.reject(new Error(message.error.message));
  else handler.resolve(message.result);
});
function send(method, params = {}, sessionId) {
  const id = ++commandId;
  socket.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

const { targetId } = await send('Target.createTarget', {
  url: `http://127.0.0.1:3000/viewer?StudyInstanceUIDs=${studyUID}`,
});
const { sessionId } = await send('Target.attachToTarget', {
  targetId,
  flatten: true,
});
await Promise.all([
  send('Page.enable', {}, sessionId),
  send('Runtime.enable', {}, sessionId),
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

async function evaluate(expression) {
  const response = await send(
    'Runtime.evaluate',
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    },
    sessionId
  );
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text);
  }
  return response.result?.value;
}
async function waitFor(expression, timeout = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timeout: ${expression}`);
}

await waitFor(
  `document.readyState === 'complete' && !!document.querySelector('[data-viewport-uid="WORKSTATION_VIEWPORT"]')`
);
await new Promise((resolve) => setTimeout(resolve, 5000));
await evaluate(`(() => {
  const button = document.querySelector(
    'button[aria-label="Công cụ đo lường — Measurement Tools"]'
  );
  button?.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
  }));
  button?.click();
})()`);
await waitFor(`document.querySelectorAll('[role="menuitem"]').length > 0`);
console.log(
  JSON.stringify(
    await evaluate(`({
      items: [...document.querySelectorAll('[role="menuitem"]')].map((item) => ({
        text: item.textContent?.trim(),
        html: item.outerHTML.slice(0, 800),
      })),
      body: document.body.innerText.slice(-3000),
    })`),
    null,
    2
  )
);
await send('Target.closeTarget', { targetId });
socket.close();

const version = await fetch('http://127.0.0.1:9222/json/version').then((r) =>
  r.json()
);
const targets = await fetch('http://127.0.0.1:9222/json/list').then((r) =>
  r.json()
);
const target = targets.find(
  (item) => item.type === 'page' && item.url.includes('/viewer?')
);
if (!target) throw new Error('No viewer target found.');

const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id) return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
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

const { sessionId } = await send('Target.attachToTarget', {
  targetId: target.id,
  flatten: true,
});
const response = await send(
  'Runtime.evaluate',
  {
    expression: `(() => ({
      url: location.href,
      titled: [...document.querySelectorAll('[title]')].map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          title: element.getAttribute('title'),
          text: element.textContent?.trim(),
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          button: element.closest('button')?.outerHTML.slice(0, 1000) ?? null,
        };
      }),
      srButtons: [...document.querySelectorAll('button')].filter((button) =>
        button.textContent?.includes('Runtime')
      ).map((button) => ({
        text: button.textContent?.trim(),
        html: button.outerHTML.slice(0, 1500),
      })),
    }))()`,
    returnByValue: true,
  },
  sessionId
);
console.log(JSON.stringify(response.result?.value, null, 2));

const clickResult = await send(
  'Runtime.evaluate',
  {
    expression: `(() => {
      const span = document.querySelector('span[title="Runtime OHIF SR"]');
      const button = span?.closest('button');
      const rect = button?.getBoundingClientRect();
      const top = rect
        ? document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2
          )
        : null;
      button?.click();
      return {
        topElement: top?.outerHTML.slice(0, 1000) ?? null,
        clicked: Boolean(button),
      };
    })()`,
    returnByValue: true,
    userGesture: true,
  },
  sessionId
);
await new Promise((resolve) => setTimeout(resolve, 3000));
const afterClick = await send(
  'Runtime.evaluate',
  {
    expression: `({
      body: document.body.innerText.slice(-3000),
      closeVisible: [...document.querySelectorAll('button')].some(
        (button) => button.title === 'Close SR'
      ),
    })`,
    returnByValue: true,
  },
  sessionId
);
console.log(
  JSON.stringify(
    {
      clickResult: clickResult.result?.value,
      afterClick: afterClick.result?.value,
    },
    null,
    2
  )
);
ws.close();

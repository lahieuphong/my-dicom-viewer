import assert from 'node:assert/strict';
import { test } from 'node:test';

// ensureAnnotationAvailable times out with window.setTimeout.
globalThis.window ??= globalThis;

const { eventTarget } = await import('@cornerstonejs/core');
const { registeredAnnotations } = await import('@cornerstonejs/tools');
const { ensureAnnotationAvailable } = await import('../../src/lib/cornerstone/annotations.ts');

const ADDED = 'ANNOTATION_ADDED';
const announce = (annotation) =>
  eventTarget.dispatchEvent(new CustomEvent(ADDED, { detail: { annotation } }));

// Counts the ANNOTATION_ADDED listeners a call leaves behind.
function countListeners() {
  let count = 0;
  const add = eventTarget.addEventListener.bind(eventTarget);
  const remove = eventTarget.removeEventListener.bind(eventTarget);
  eventTarget.addEventListener = (type, listener, options) => {
    if (type === ADDED) count += 1;
    return add(type, listener, options);
  };
  eventTarget.removeEventListener = (type, listener, options) => {
    if (type === ADDED) count -= 1;
    return remove(type, listener, options);
  };
  return {
    get count() { return count; },
    restore() {
      eventTarget.addEventListener = add;
      eventTarget.removeEventListener = remove;
    },
  };
}

test('a registered annotation resolves right away without listening', async () => {
  const listeners = countListeners();
  try {
    const registered = { annotationUID: 'present' };
    registeredAnnotations.set('present', registered);
    assert.equal(await ensureAnnotationAvailable('present', 1000), registered);
    assert.equal(listeners.count, 0);
  } finally {
    listeners.restore();
    registeredAnnotations.clear();
  }
});

test('an annotation added later resolves on its ANNOTATION_ADDED, not on another one', async () => {
  const listeners = countListeners();
  try {
    const started = Date.now();
    const waiting = ensureAnnotationAvailable('later', 2000);
    let settled = false;
    waiting.then(() => { settled = true; });

    announce({ annotationUID: 'someone-else' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(settled, false);

    const registered = { annotationUID: 'later', from: 'state' };
    registeredAnnotations.set('later', registered);
    announce({ annotationUID: 'later', from: 'event' });

    // The state's instance wins over the event's copy.
    assert.equal(await waiting, registered);
    assert.ok(Date.now() - started < 1000, 'resolved on the event, not the timeout');
    assert.equal(listeners.count, 0);
  } finally {
    listeners.restore();
    registeredAnnotations.clear();
  }
});

test('the event annotation is used when the state does not return it', async () => {
  const waiting = ensureAnnotationAvailable('event-only', 2000);
  const added = { annotationUID: 'event-only' };
  announce(added);
  assert.equal(await waiting, added);
});

test('the timeout checks the state once more, for tools that dispatch no event', async () => {
  const listeners = countListeners();
  try {
    const waiting = ensureAnnotationAvailable('silent', 30);
    const registered = { annotationUID: 'silent' };
    registeredAnnotations.set('silent', registered);
    assert.equal(await waiting, registered);
    assert.equal(listeners.count, 0);
  } finally {
    listeners.restore();
    registeredAnnotations.clear();
  }
});

test('a missing annotation resolves null after the timeout; a zero timeout does not wait', async () => {
  const listeners = countListeners();
  try {
    assert.equal(await ensureAnnotationAvailable('missing', 20), null);
    assert.equal(await ensureAnnotationAvailable('missing', 0), null);
    assert.equal(listeners.count, 0);
  } finally {
    listeners.restore();
  }
});

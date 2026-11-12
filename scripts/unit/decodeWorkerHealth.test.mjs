import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DECODE_WORKER_RELOAD_INTERVAL_MS,
  DECODE_WORKER_RELOAD_KEY,
  watchDecodeWorkers,
} from '../../src/lib/cornerstone/decodeWorkerHealth.ts';

function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    items,
  };
}

function setup({ reloadOnFailure = true, storage = memoryStorage(), now = 1_000_000, workerCount = 3 } = {}) {
  const workers = Array.from({ length: workerCount }, () => new EventTarget());
  const calls = { reloads: 0, reports: [] };
  const stop = watchDecodeWorkers(workers, {
    reloadOnFailure,
    reload: () => { calls.reloads += 1; },
    storage,
    now: () => now,
    report: (message) => calls.reports.push(message),
  });
  return { workers, calls, storage, stop };
}

const fail = (worker) => worker.dispatchEvent(new Event('error'));
const answer = (worker) => worker.dispatchEvent(new Event('message'));

test('a worker that fails before answering reloads the page once during development', () => {
  const { workers, calls, storage } = setup();
  workers.forEach(fail);
  assert.equal(calls.reloads, 1);
  assert.equal(storage.items.get(DECODE_WORKER_RELOAD_KEY), '1000000');
  assert.equal(calls.reports.length, 1);
});

test('a worker error after the worker has answered is not a startup failure', () => {
  const { workers, calls } = setup({ workerCount: 1 });
  answer(workers[0]);
  fail(workers[0]);
  assert.equal(calls.reloads, 0);
  assert.deepEqual(calls.reports, []);
});

test('a recent reload is not repeated; the failure is reported instead', () => {
  const now = 1_000_000;
  const storage = memoryStorage({
    [DECODE_WORKER_RELOAD_KEY]: String(now - DECODE_WORKER_RELOAD_INTERVAL_MS + 1),
  });
  const { workers, calls } = setup({ storage, now });
  fail(workers[1]);
  assert.equal(calls.reloads, 0);
  assert.match(calls.reports[0], /failed to start/);
});

test('an older reload allows another one', () => {
  const now = 1_000_000;
  const storage = memoryStorage({
    [DECODE_WORKER_RELOAD_KEY]: String(now - DECODE_WORKER_RELOAD_INTERVAL_MS),
  });
  const { workers, calls } = setup({ storage, now });
  fail(workers[0]);
  assert.equal(calls.reloads, 1);
});

test('outside development the failure is only reported', () => {
  const { workers, calls, storage } = setup({ reloadOnFailure: false });
  fail(workers[2]);
  assert.equal(calls.reloads, 0);
  assert.equal(calls.reports.length, 1);
  assert.equal(storage.items.has(DECODE_WORKER_RELOAD_KEY), false);
});

test('unreadable storage still reloads once; stopping ends the watch', () => {
  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const first = setup({ storage: throwing });
  fail(first.workers[0]);
  assert.equal(first.calls.reloads, 1);

  const second = setup();
  second.stop();
  second.workers.forEach(fail);
  assert.equal(second.calls.reloads, 0);
});

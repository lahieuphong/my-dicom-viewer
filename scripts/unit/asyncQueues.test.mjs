import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createLatestWinsQueue,
  createSingleFlight,
} from '../../src/lib/utils/asyncQueues.ts';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function gatedQueue(items, options = {}) {
  const gates = Object.fromEntries(items.map((item) => [item, deferred()]));
  const ran = [];
  const queue = createLatestWinsQueue({
    run: async (item) => {
      ran.push(item);
      await gates[item].promise;
    },
    ...options,
  });
  return { queue, gates, ran };
}

test('latest-wins queue runs the first item, then only the last one queued meanwhile', async () => {
  const { queue, gates, ran } = gatedQueue(['a', 'b', 'c']);

  const idle = queue.enqueue('a');
  assert.equal(queue.isRunning(), true);
  assert.equal(queue.enqueue('b'), idle, 'a running queue returns its promise');
  queue.enqueue('c');

  gates.a.resolve();
  gates.c.resolve();
  await idle;

  assert.deepEqual(ran, ['a', 'c']);
  assert.equal(queue.isRunning(), false);
});

test('latest-wins queue drops a matching pending item but not the running one', async () => {
  const { queue, gates, ran } = gatedQueue(['a', 'b']);

  const idle = queue.enqueue('a');
  queue.enqueue('b');
  queue.dropPending((item) => item === 'a');
  queue.dropPending((item) => item === 'b');

  gates.a.resolve();
  await idle;
  assert.deepEqual(ran, ['a']);
});

test('latest-wins queue re-checks shouldSkip right before an item runs', async () => {
  const skipped = new Set(['x']);
  const { queue, gates, ran } = gatedQueue(['a', 'b'], {
    shouldSkip: (item) => skipped.has(item),
  });

  await queue.enqueue('x');
  assert.deepEqual(ran, [], 'a skipped item never starts the queue');

  const idle = queue.enqueue('a');
  queue.enqueue('b');
  skipped.add('b');
  gates.a.resolve();
  await idle;
  assert.deepEqual(ran, ['a']);
});

test('latest-wins queue keeps going after a failed task', async () => {
  const ran = [];
  const queue = createLatestWinsQueue({
    run: async (item) => {
      ran.push(item);
      if (item === 'a') throw new Error('navigation failed');
    },
  });

  const idle = queue.enqueue('a');
  queue.enqueue('b');
  await idle;
  assert.deepEqual(ran, ['a', 'b']);
});

test('single flight shares the in-flight promise per key and releases it when settled', async () => {
  const flight = createSingleFlight();
  const gate = deferred();
  let calls = 0;
  const task = () => {
    calls += 1;
    return gate.promise;
  };

  const first = flight.run('uid-1', task);
  assert.equal(flight.run('uid-1', task), first);
  assert.notEqual(flight.run('uid-2', () => Promise.resolve(false)), first);
  assert.equal(calls, 1);

  gate.resolve(true);
  assert.equal(await first, true);
  await Promise.resolve();

  const second = flight.run('uid-1', () => Promise.resolve(false));
  assert.notEqual(second, first, 'a settled key starts a new task');
  assert.equal(await second, false);
});

test('single flight also releases a rejected task', async () => {
  const flight = createSingleFlight();
  const failed = flight.run('uid', () => Promise.reject(new Error('boom')));
  await assert.rejects(failed, /boom/);
  await Promise.resolve();
  assert.equal(await flight.run('uid', () => Promise.resolve('again')), 'again');
});

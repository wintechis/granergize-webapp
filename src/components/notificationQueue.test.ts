/// <reference lib="deno.ns" />
import assert from "node:assert";
import {
  enqueue,
  initialQueueState,
  type Notice,
  promoteNext,
  type QueueState,
  requestClose,
} from "./notificationQueue.ts";

const notice = (key: number, message = `m${key}`): Notice => ({
  key,
  message,
  severity: "info",
});

Deno.test("enqueue: first notice becomes current and opens", () => {
  const s = enqueue(initialQueueState, notice(1));
  assert.deepEqual(s, { current: notice(1), pending: [], open: true });
});

Deno.test("enqueue: a second notice waits in pending, current is untouched", () => {
  const s = enqueue(enqueue(initialQueueState, notice(1)), notice(2));
  assert.deepEqual(s.current, notice(1));
  assert.equal(s.open, true);
  assert.deepEqual(s.pending, [notice(2)]);
});

Deno.test("requestClose: closes without dropping the current notice", () => {
  const s = requestClose(enqueue(initialQueueState, notice(1)));
  assert.equal(s.open, false);
  assert.deepEqual(s.current, notice(1)); // still mounted for the exit transition
});

Deno.test("promoteNext: drains the queue FIFO, then goes idle", () => {
  // Three notices arrive during one busy window (the login burst).
  let s: QueueState = [1, 2, 3].reduce(
    (acc, k) => enqueue(acc, notice(k)),
    initialQueueState,
  );
  // 1 shows; 2 and 3 wait — nothing dropped.
  assert.deepEqual(s.current, notice(1));
  assert.deepEqual(s.pending, [notice(2), notice(3)]);

  // Close 1 → promote 2.
  s = promoteNext(requestClose(s));
  assert.deepEqual(s, { current: notice(2), pending: [notice(3)], open: true });

  // Close 2 → promote 3.
  s = promoteNext(requestClose(s));
  assert.deepEqual(s, { current: notice(3), pending: [], open: true });

  // Close 3 → idle.
  s = promoteNext(requestClose(s));
  assert.deepEqual(s, initialQueueState);
});

Deno.test("enqueue after draining starts a fresh cycle", () => {
  let s = promoteNext(requestClose(enqueue(initialQueueState, notice(1))));
  assert.deepEqual(s, initialQueueState);
  s = enqueue(s, notice(2));
  assert.deepEqual(s, { current: notice(2), pending: [], open: true });
});

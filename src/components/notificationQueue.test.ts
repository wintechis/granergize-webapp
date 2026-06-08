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

Deno.test("enqueue: a duplicate of the CURRENT notice is ignored (no backlog)", () => {
  // Same message+severity arriving while it's already showing adds nothing.
  const s1 = enqueue(initialQueueState, notice(1, "Joined"));
  const s2 = enqueue(s1, { key: 2, message: "Joined", severity: "info" });
  assert.deepEqual(s2.current, notice(1, "Joined"));
  assert.deepEqual(s2.pending, []); // not queued
});

Deno.test("enqueue: a duplicate of the LAST pending notice is ignored", () => {
  // current = A, pending = [B]; another B must not stack a second copy.
  let s = enqueue(initialQueueState, notice(1, "A"));
  s = enqueue(s, { key: 2, message: "B", severity: "info" });
  s = enqueue(s, { key: 3, message: "B", severity: "info" });
  assert.deepEqual(s.pending, [{ key: 2, message: "B", severity: "info" }]);
});

Deno.test("enqueue: a burst of identical notices collapses to one", () => {
  // The room-switch case: six identical toasts must not queue a 6-deep train.
  const s = [1, 2, 3, 4, 5, 6].reduce(
    (acc, k) => enqueue(acc, { key: k, message: "You joined", severity: "info" }),
    initialQueueState,
  );
  assert.equal(s.current?.message, "You joined");
  assert.deepEqual(s.pending, []);
});

Deno.test("enqueue: same message but DIFFERENT severity still queues", () => {
  // An info then an error with identical text are distinct events — keep both.
  let s = enqueue(initialQueueState, { key: 1, message: "X", severity: "info" });
  s = enqueue(s, { key: 2, message: "X", severity: "error" });
  assert.deepEqual(s.pending, [{ key: 2, message: "X", severity: "error" }]);
});

Deno.test("enqueue: a duplicate is allowed again once the first has drained", () => {
  // After the toast plays and the queue idles, the same message is informative
  // again (a genuinely new occurrence) — it isn't permanently suppressed.
  let s = enqueue(initialQueueState, notice(1, "Saved"));
  s = promoteNext(requestClose(s)); // drain → idle
  assert.deepEqual(s, initialQueueState);
  s = enqueue(s, { key: 2, message: "Saved", severity: "info" });
  assert.deepEqual(s.current, { key: 2, message: "Saved", severity: "info" });
});

Deno.test("enqueue after draining starts a fresh cycle", () => {
  let s = promoteNext(requestClose(enqueue(initialQueueState, notice(1))));
  assert.deepEqual(s, initialQueueState);
  s = enqueue(s, notice(2));
  assert.deepEqual(s, { current: notice(2), pending: [], open: true });
});

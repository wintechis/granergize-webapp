/// <reference lib="deno.ns" />
import assert from "node:assert";
import {
  clearNotificationLog,
  getNotificationLog,
  type LoggedNotice,
  recordNotification,
  subscribeNotificationLog,
} from "./notificationLog.ts";

const notice = (key: number): LoggedNotice => ({
  key,
  message: `m${key}`,
  severity: "info",
  at: key,
});

// The store is a module singleton — clear before each case so order doesn't matter.
function reset(): void {
  clearNotificationLog();
}

Deno.test("recordNotification: newest first", () => {
  reset();
  recordNotification(notice(1));
  recordNotification(notice(2));
  assert.deepEqual(getNotificationLog().map((n) => n.key), [2, 1]);
});

Deno.test("recordNotification: keeps consecutive duplicates (unlike the snackbar queue)", () => {
  reset();
  const dup: LoggedNotice = { key: 1, message: "same", severity: "info", at: 1 };
  recordNotification({ ...dup, key: 1 });
  recordNotification({ ...dup, key: 2 });
  assert.equal(getNotificationLog().length, 2);
});

Deno.test("recordNotification: bounded to the last 100", () => {
  reset();
  for (let i = 1; i <= 105; i++) recordNotification(notice(i));
  const log = getNotificationLog();
  assert.equal(log.length, 100);
  assert.equal(log[0].key, 105); // newest kept
  assert.equal(log[99].key, 6); // oldest 5 dropped
});

Deno.test("clearNotificationLog: empties the log", () => {
  reset();
  recordNotification(notice(1));
  clearNotificationLog();
  assert.equal(getNotificationLog().length, 0);
});

Deno.test("subscribeNotificationLog: notifies on record and clear, stops after unsubscribe", () => {
  reset();
  let calls = 0;
  const unsub = subscribeNotificationLog(() => calls++);
  recordNotification(notice(1));
  clearNotificationLog();
  assert.equal(calls, 2);
  unsub();
  recordNotification(notice(2));
  assert.equal(calls, 2);
});

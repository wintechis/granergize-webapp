/// <reference lib="deno.ns" />
import { strictEqual } from "node:assert";
import { shouldRestoreSession } from "./sessionRestore.ts";

const base = {
  auto: true,
  suppressRestore: false,
  sessionExpired: false,
  sessionResponded: false,
  restoreAttempted: false,
};

Deno.test("restores when auto and nothing blocks it", () => {
  strictEqual(shouldRestoreSession(base), true);
});

Deno.test("never restores when auto-restore is disabled", () => {
  strictEqual(shouldRestoreSession({ ...base, auto: false }), false);
});

Deno.test("skips restore after a destructive/explicit logout", () => {
  strictEqual(shouldRestoreSession({ ...base, suppressRestore: true }), false);
});

Deno.test("skips restore once the session is known expired", () => {
  strictEqual(shouldRestoreSession({ ...base, sessionExpired: true }), false);
});

Deno.test("skips restore once a session event has already responded", () => {
  strictEqual(shouldRestoreSession({ ...base, sessionResponded: true }), false);
});

Deno.test("skips restore once one was already attempted (loop guard)", () => {
  // A prior silent restore that bounced to a dead-end "Unknown client" IdP page
  // must not trigger a second auto-restore (which would bounce again).
  strictEqual(shouldRestoreSession({ ...base, restoreAttempted: true }), false);
});

Deno.test("any single blocker suppresses restore", () => {
  // Every blocker, individually, must be sufficient to suppress.
  for (
    const key of [
      "suppressRestore",
      "sessionExpired",
      "sessionResponded",
      "restoreAttempted",
    ] as const
  ) {
    strictEqual(
      shouldRestoreSession({ ...base, [key]: true }),
      false,
      `${key} should block restore`,
    );
  }
});

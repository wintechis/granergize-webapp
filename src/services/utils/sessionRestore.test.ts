/// <reference lib="deno.ns" />
import { strictEqual } from "node:assert";
import { shouldRestoreSession } from "./sessionRestore.ts";

const base = {
  auto: true,
  suppressRestore: false,
  sessionExpired: false,
  sessionResponded: false,
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

Deno.test("any single blocker suppresses restore", () => {
  // Every blocker, individually, must be sufficient to suppress.
  for (
    const key of [
      "suppressRestore",
      "sessionExpired",
      "sessionResponded",
    ] as const
  ) {
    strictEqual(
      shouldRestoreSession({ ...base, [key]: true }),
      false,
      `${key} should block restore`,
    );
  }
});

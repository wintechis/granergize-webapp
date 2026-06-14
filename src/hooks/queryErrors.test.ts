/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { classifyMutationError, classifyQueryError } from "./queryErrors.ts";
import { SessionExpiredError } from "../services/TurtleParsingService.ts";
import { ConflictError } from "../services/pod/podWrite.ts";
import {
  markSessionExpired,
  resetSessionGate,
} from "../services/pod/sessionGate.ts";

Deno.test("classifyQueryError: SessionExpiredError → warning with the fixed re-login sentence", () => {
  // NOT error.message (which carries HTTP detail like "… (HTTP 401)" for the
  // log) — the user-facing sentence matches the session-gate logout toast.
  const r = classifyQueryError(new SessionExpiredError("token gone"));
  assert.equal(r.severity, "warning");
  assert.equal(r.message, "Session expired — please log in again");
});

Deno.test("classifyQueryError: ConflictError → warning, reload-and-retry message", () => {
  const r = classifyQueryError(
    new ConflictError("https://pod.example/granergize/dataSources.ttl"),
  );
  assert.equal(r.severity, "warning");
  assert.match(r.message, /reload/i);
});

Deno.test("classifyQueryError: generic Error → error with its message", () => {
  const r = classifyQueryError(new Error("boom"));
  assert.equal(r.severity, "error");
  assert.equal(r.message, "boom");
});

Deno.test("classifyQueryError: non-Error value → error, stringified", () => {
  const r = classifyQueryError("nope");
  assert.equal(r.severity, "error");
  assert.equal(r.message, "nope");
});

Deno.test("classifyQueryError: an action wraps a generic error in the standard phrasing", () => {
  const r = classifyQueryError(new Error("boom"), "update the building");
  assert.equal(r.severity, "error");
  assert.equal(r.message, "Failed to update the building: boom");
});

Deno.test("classifyQueryError: the classified warnings ignore the action", () => {
  // SessionExpired / Conflict messages are complete sentences about an
  // app-level state; wrapping them in "Failed to …" would misattribute them.
  const expired = classifyQueryError(
    new SessionExpiredError("token gone"),
    "update the building",
  );
  assert.equal(expired.message, "Session expired — please log in again");
  assert.equal(expired.severity, "warning");
  const conflict = classifyQueryError(
    new ConflictError("https://pod.example/x.ttl"),
    "update the building",
  );
  assert.match(conflict.message, /reload/i);
  assert.equal(conflict.severity, "warning");
});

Deno.test("classifyQueryError: a generic error while the session-expiry gate is tripped → expiry warning, not 'Failed to …'", () => {
  // When a query/mutation is in flight and the session expires, its 401 surfaces
  // as a generic "… HTTP 401" (only the buildings loader makes a
  // SessionExpiredError). The gate being tripped means it's really an expiry, so
  // it must collapse into the same warning instead of stacking a "Failed to …"
  // error on the gate's logout toast.
  markSessionExpired();
  try {
    const generic = classifyQueryError(new Error("Failed to read x.ttl: HTTP 401"));
    assert.equal(generic.severity, "warning");
    assert.equal(generic.message, "Session expired — please log in again");
    // An action does not re-wrap it (same rule as the other classified warnings).
    const withAction = classifyQueryError(new Error("boom"), "update the building");
    assert.equal(withAction.severity, "warning");
    assert.equal(withAction.message, "Session expired — please log in again");
    // A ConflictError racing the expiry is moot too — expiry wins.
    const conflict = classifyQueryError(new ConflictError("https://pod.example/x.ttl"));
    assert.equal(conflict.severity, "warning");
    assert.equal(conflict.message, "Session expired — please log in again");
  } finally {
    resetSessionGate();
  }
  // Gate reset: classification is back to normal for subsequent loads.
  assert.equal(classifyQueryError(new Error("boom")).severity, "error");
});

Deno.test("classifyMutationError: a non-silent mutation error while expired → expiry warning (silent still wins)", () => {
  markSessionExpired();
  try {
    const note = classifyMutationError(new Error("HTTP 401"), {
      action: "share the view",
    });
    assert.equal(note?.severity, "warning");
    assert.equal(note?.message, "Session expired — please log in again");
    // silent mutations still suppress entirely — the dialog owns presentation.
    assert.equal(
      classifyMutationError(new Error("HTTP 401"), { silent: true }),
      null,
    );
  } finally {
    resetSessionGate();
  }
});

Deno.test("classifyMutationError: honours meta (action phrasing, silent → null)", () => {
  const withAction = classifyMutationError(new Error("boom"), {
    action: "share the view",
  });
  assert.equal(withAction?.message, "Failed to share the view: boom");
  assert.equal(withAction?.severity, "error");

  assert.equal(
    classifyMutationError(new Error("boom"), { silent: true }),
    null,
    "silent suppresses the toast entirely",
  );
  // silent beats the other classes too — the dialog owns presentation.
  assert.equal(
    classifyMutationError(new SessionExpiredError("token gone"), {
      silent: true,
    }),
    null,
  );

  const bare = classifyMutationError(new Error("boom"));
  assert.equal(bare?.message, "boom", "no meta → today's raw-message behaviour");
});

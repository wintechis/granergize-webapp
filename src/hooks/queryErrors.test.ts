/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { classifyMutationError, classifyQueryError } from "./queryErrors.ts";
import { SessionExpiredError } from "../services/TurtleParsingService.ts";
import { ConflictError } from "../services/pod/podWrite.ts";

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

/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { classifyQueryError } from "./queryErrors.ts";
import { SessionExpiredError } from "../services/TurtleParsingService.ts";
import { ConflictError } from "../services/pod/podWrite.ts";

Deno.test("classifyQueryError: SessionExpiredError → warning, keeps its message", () => {
  const r = classifyQueryError(new SessionExpiredError("token gone"));
  assert.equal(r.severity, "warning");
  assert.equal(r.message, "token gone");
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

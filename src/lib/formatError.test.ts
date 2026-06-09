/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { formatError } from "./formatError.ts";

Deno.test("formatError: unwraps an Error to its .message", () => {
  assert.equal(
    formatError("save the building", new Error("boom")),
    "Failed to save the building: boom",
  );
});

Deno.test("formatError: stringifies non-Error values", () => {
  assert.equal(
    formatError("revoke access", "nope"),
    "Failed to revoke access: nope",
  );
  assert.equal(formatError("reach the pod", 404), "Failed to reach the pod: 404");
});

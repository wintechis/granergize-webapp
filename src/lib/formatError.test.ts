/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { formatError } from "./formatError.ts";

// `action` is now a catalog message id; the template + the action phrase are
// resolved in the active locale. Under `deno test` there is no browser preference
// and no localStorage, so the active locale is the default (en) — these assert the
// English output. (The catalog itself, incl. de/fr, is covered in messages.test.ts.)

Deno.test("formatError: en template with the action phrase + Error message", () => {
  assert.equal(
    formatError("actionAddBuilding", new Error("boom")),
    "Failed to add the building: boom",
  );
});

Deno.test("formatError: stringifies a non-Error detail", () => {
  assert.equal(
    formatError("actionShareBuilding", "nope"),
    "Failed to share the building: nope",
  );
});

Deno.test("formatError: numeric detail", () => {
  assert.equal(
    formatError("actionReadInbox", 404),
    "Failed to read your inbox: 404",
  );
});

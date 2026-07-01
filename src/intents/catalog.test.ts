/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { type IntentEntry, intentExposure, INTENTS } from "./catalog.ts";

Deno.test("intent names are unique", () => {
  const names = INTENTS.map((i) => i.name);
  assert.equal(new Set(names).size, names.length);
});

Deno.test("every entry carries the load-bearing fields", () => {
  for (const i of INTENTS) {
    // `action` is "" for hooks that declare no meta.action (their errors are
    // handled outside the central toast). `hook` is required for WRITES (the
    // adapter owns busy state, the central toast and the invalidations); a read
    // may be palette-only (reached via query()/invokeByName — no per-verb
    // useMutation wrapper), and navigate intents are pure route builders.
    assert.ok(i.name, `incomplete entry: ${i.name}`);
    if (i.effect === "write") {
      assert.ok(i.hook, `write entry missing hook: ${i.name}`);
    }
    assert.equal(typeof i.action, "string", `missing action: ${i.name}`);
    assert.ok(["write", "read", "navigate"].includes(i.effect));
  }
});

Deno.test("intentExposure defaults to standard", () => {
  const standard: IntentEntry = {
    name: "X",
    action: "do x",
    effect: "write",
    hook: "useX",
  };
  assert.equal(intentExposure(standard), "standard");
  assert.equal(
    intentExposure({ ...standard, exposure: "developer" }),
    "developer",
  );
});

Deno.test("seed exercises every field (read + silent + developer present)", () => {
  assert.ok(INTENTS.some((i) => i.effect === "read"));
  assert.ok(INTENTS.some((i) => i.silentError));
  assert.ok(INTENTS.some((i) => i.exposure === "developer"));
});

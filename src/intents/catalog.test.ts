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
    // handled outside the central toast). `hook` is required for write/read (the
    // mutations.ts drift guard); navigate intents have no hook (a pure route-builder
    // core in navigate.ts) — so identity is `name` always, `hook` for non-navigate.
    assert.ok(i.name, `incomplete entry: ${i.name}`);
    if (i.effect !== "navigate") {
      assert.ok(i.hook, `non-navigate entry missing hook: ${i.name}`);
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

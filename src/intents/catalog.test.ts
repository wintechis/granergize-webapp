/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { type IntentEntry, intentExposure, INTENTS } from "./catalog.ts";

Deno.test("intent names are unique", () => {
  const names = INTENTS.map((i) => i.name);
  assert.equal(new Set(names).size, names.length);
});

Deno.test("every entry carries the load-bearing fields", () => {
  for (const i of INTENTS) {
    assert.ok(i.name && i.action && i.hook, `incomplete entry: ${i.name}`);
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

/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { shouldDialogClose } from "./dialogGuard.ts";

Deno.test("shouldDialogClose: a backdrop click never closes", () => {
  assert.equal(shouldDialogClose("backdropClick"), false);
  assert.equal(shouldDialogClose("backdropClick", { dirty: false }), false);
  assert.equal(shouldDialogClose("backdropClick", { dirty: true }), false);
});

Deno.test("shouldDialogClose: busy suppresses all closing", () => {
  assert.equal(shouldDialogClose("escapeKeyDown", { busy: true }), false);
  assert.equal(shouldDialogClose("backdropClick", { busy: true }), false);
  assert.equal(
    shouldDialogClose("escapeKeyDown", { busy: true, dirty: false }),
    false,
  );
});

Deno.test("shouldDialogClose: dismissable closes on backdrop (info popups)", () => {
  assert.equal(shouldDialogClose("backdropClick", { dismissable: true }), true);
  // still suppressed while busy, even when dismissable
  assert.equal(
    shouldDialogClose("backdropClick", { dismissable: true, busy: true }),
    false,
  );
});

Deno.test("shouldDialogClose: Escape closes when not dirty", () => {
  assert.equal(shouldDialogClose("escapeKeyDown"), true);
  assert.equal(shouldDialogClose("escapeKeyDown", { dirty: false }), true);
});

Deno.test("shouldDialogClose: Escape while dirty confirms (declined keeps open)", () => {
  const original = globalThis.confirm;
  try {
    globalThis.confirm = () => false;
    assert.equal(shouldDialogClose("escapeKeyDown", { dirty: true }), false);
    globalThis.confirm = () => true;
    assert.equal(shouldDialogClose("escapeKeyDown", { dirty: true }), true);
  } finally {
    globalThis.confirm = original;
  }
});

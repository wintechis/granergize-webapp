/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { dialogCloseDecision } from "./dialogGuard.ts";

Deno.test("dialogCloseDecision: a backdrop click never closes", () => {
  assert.equal(dialogCloseDecision("backdropClick"), "keepOpen");
  assert.equal(dialogCloseDecision("backdropClick", { dirty: false }), "keepOpen");
  assert.equal(dialogCloseDecision("backdropClick", { dirty: true }), "keepOpen");
});

Deno.test("dialogCloseDecision: busy suppresses all closing", () => {
  assert.equal(dialogCloseDecision("escapeKeyDown", { busy: true }), "keepOpen");
  assert.equal(dialogCloseDecision("backdropClick", { busy: true }), "keepOpen");
  assert.equal(
    dialogCloseDecision("escapeKeyDown", { busy: true, dirty: true }),
    "keepOpen",
  );
});

Deno.test("dialogCloseDecision: dismissable closes on backdrop (info popups)", () => {
  assert.equal(dialogCloseDecision("backdropClick", { dismissable: true }), "close");
  // still suppressed while busy, even when dismissable
  assert.equal(
    dialogCloseDecision("backdropClick", { dismissable: true, busy: true }),
    "keepOpen",
  );
});

Deno.test("dialogCloseDecision: Escape closes when not dirty", () => {
  assert.equal(dialogCloseDecision("escapeKeyDown"), "close");
  assert.equal(dialogCloseDecision("escapeKeyDown", { dirty: false }), "close");
});

Deno.test("dialogCloseDecision: Escape while dirty asks to confirm", () => {
  // The intent to confirm — Modal runs the actual async confirm via ConfirmContext.
  assert.equal(dialogCloseDecision("escapeKeyDown", { dirty: true }), "confirm");
});

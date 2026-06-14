/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { resolveLanguage, SUPPORTED } from "./language.ts";

Deno.test("resolveLanguage returns the first supported preference", () => {
  assert.equal(resolveLanguage(SUPPORTED, ["fr-CA", "en"]), "fr");
  assert.equal(resolveLanguage(SUPPORTED, ["en", "de"]), "en");
});

Deno.test("resolveLanguage region-strips BCP-47 tags", () => {
  assert.equal(resolveLanguage(SUPPORTED, ["de-DE", "en"]), "de");
  assert.equal(resolveLanguage(SUPPORTED, ["de-AT"]), "de");
  assert.equal(resolveLanguage(SUPPORTED, ["DE"]), "de");
});

Deno.test("resolveLanguage skips unsupported preferences to the next match", () => {
  assert.equal(resolveLanguage(SUPPORTED, ["es", "it", "fr"]), "fr");
});

Deno.test("resolveLanguage defaults to en when nothing matches", () => {
  assert.equal(resolveLanguage(SUPPORTED, ["es"]), "en");
  assert.equal(resolveLanguage(SUPPORTED, []), "en");
});

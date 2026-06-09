/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { normalizeIssuer } from "./normalizeIssuer.ts";

Deno.test("normalizeIssuer prepends https:// to a bare domain", () => {
  assert.equal(normalizeIssuer("inrupt.net"), "https://inrupt.net");
  assert.equal(normalizeIssuer("solidcommunity.net"), "https://solidcommunity.net");
});

Deno.test("normalizeIssuer keeps an https:// URL unchanged", () => {
  assert.equal(
    normalizeIssuer("https://solidcommunity.net"),
    "https://solidcommunity.net",
  );
});

Deno.test("normalizeIssuer keeps an http://localhost dev/test issuer (the bug fix)", () => {
  // Previously this was mangled into https://http://localhost:3456/ → unresolvable.
  assert.equal(normalizeIssuer("http://localhost:3456/"), "http://localhost:3456/");
});

Deno.test("normalizeIssuer trims surrounding whitespace", () => {
  assert.equal(normalizeIssuer("  inrupt.net  "), "https://inrupt.net");
  assert.equal(
    normalizeIssuer("  https://pod.example/  "),
    "https://pod.example/",
  );
});

/// <reference lib="deno.ns" />
import { strictEqual } from "node:assert";
import { safeHref } from "./safeHref.ts";

Deno.test("safeHref passes through http/https/mailto absolute URIs", () => {
  const ok = [
    "http://example.org/x",
    "https://alice.solidcommunity.net/granergize/buildings/b1.ttl#building1",
    "https://solid.ti.rw.fau.de/gra/vocab.ttl#energyConsumption",
    "mailto:alice@example.org",
  ];
  for (const uri of ok) {
    strictEqual(safeHref(uri), uri, uri);
  }
});

Deno.test("safeHref rejects javascript: and other dangerous schemes", () => {
  const bad = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ];
  for (const uri of bad) {
    strictEqual(safeHref(uri), null, uri);
  }
});

Deno.test("safeHref rejects relative or malformed values", () => {
  strictEqual(safeHref("/buildings/b1.ttl"), null);
  strictEqual(safeHref("#building1"), null);
  strictEqual(safeHref("not a uri"), null);
  strictEqual(safeHref(""), null);
});

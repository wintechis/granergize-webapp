/// <reference lib="deno.ns" />
import { strictEqual } from "node:assert";
import { safeHref, safeImageSrc } from "./safeHref.ts";

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

Deno.test("safeImageSrc passes plain http/https URIs through unchanged", () => {
  const ok = [
    "https://org.example/logo.png",
    "http://org.example/assets/logo.svg",
  ];
  for (const uri of ok) {
    strictEqual(safeImageSrc(uri), uri, uri);
  }
});

Deno.test("safeImageSrc rejects non-fetchable schemes and malformed values", () => {
  const bad = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://app.example/123",
    "/logo.png",
    "not a uri",
    "",
  ];
  for (const uri of bad) {
    strictEqual(safeImageSrc(uri), null, uri);
  }
});

Deno.test("safeImageSrc percent-encodes attribute-breaking characters", () => {
  // A crafted foaf:logo value trying to break out of the marker's interpolated
  // src attribute — quotes/angles come back encoded, so the markup stays inert.
  strictEqual(
    safeImageSrc('https://evil.example/x" onerror="alert(1)'),
    "https://evil.example/x%22 onerror=%22alert(1)",
  );
  strictEqual(
    safeImageSrc("https://evil.example/<img>'x'"),
    "https://evil.example/%3Cimg%3E%27x%27",
  );
});

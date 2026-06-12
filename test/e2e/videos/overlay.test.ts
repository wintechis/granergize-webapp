/// <reference lib="deno.ns" />
import assert from "node:assert";
import {
  ACTOR_THEMES,
  badgeHtml,
  BADGE_ID,
  CAPTION_ID,
  CURSOR_ID,
  escapeHtml,
  installOverlayScript,
  overlayCss,
} from "./overlay.ts";

Deno.test("escapeHtml escapes markup-significant characters", () => {
  assert.strictEqual(
    escapeHtml(`<img src="x" onerror=a&b>`),
    "&lt;img src=&quot;x&quot; onerror=a&amp;b&gt;",
  );
});

Deno.test("overlayCss styles all three overlay elements, click-transparent", () => {
  const css = overlayCss("#894c40");
  for (const id of [CURSOR_ID, CAPTION_ID, BADGE_ID]) {
    assert.ok(css.includes(`#${id}`), `styles #${id}`);
  }
  assert.ok(css.includes("pointer-events: none"));
  assert.ok(css.includes("#894c40"), "uses the actor accent");
});

Deno.test("badgeHtml carries the actor identity, escaped", () => {
  const html = badgeHtml(
    { slot: "A", name: 'Alice <"A">', company: "Ahlmann & Co", accent: "#894c40" },
    "data:image/png;base64,AAAA",
  );
  assert.ok(html.includes("Alice &lt;&quot;A&quot;&gt;"), "name escaped");
  assert.ok(html.includes("Ahlmann &amp; Co"), "company escaped");
  assert.ok(html.includes('src="data:image/png;base64,AAAA"'));
  assert.ok(!html.includes('<"A">'), "no raw markup from the name");
});

Deno.test("installOverlayScript is valid JS embedding badge and styles", () => {
  const script = installOverlayScript(ACTOR_THEMES.A, "data:image/png;base64,AAAA");
  // Parse check only (no DOM here): an injection-broken template would throw.
  new Function(script);
  assert.ok(script.includes("demo-overlay-style"), "idempotence guard present");
  assert.ok(script.includes("Alice Ahlmann"));
  assert.ok(script.includes("Ahlmann Logistik GmbH"));
});

Deno.test("every actor theme is complete", () => {
  for (const slot of ["A", "B", "C"] as const) {
    const t = ACTOR_THEMES[slot];
    assert.strictEqual(t.slot, slot);
    assert.ok(t.name && t.company, `${slot} has name + company`);
    assert.match(t.accent, /^#[0-9a-f]{6}$/i);
  }
});

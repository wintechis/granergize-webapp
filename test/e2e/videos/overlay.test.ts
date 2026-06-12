/// <reference lib="deno.ns" />
import assert from "node:assert";
import {
  ACTOR_THEMES,
  CAPTION_ID,
  CURSOR_ID,
  endCardHtml,
  escapeHtml,
  installOverlayScript,
  INTRO_ID,
  introCardHtml,
  loadingCardHtml,
  overlayCss,
} from "./overlay.ts";

Deno.test("escapeHtml escapes markup-significant characters", () => {
  assert.strictEqual(
    escapeHtml(`<img src="x" onerror=a&b>`),
    "&lt;img src=&quot;x&quot; onerror=a&amp;b&gt;",
  );
});

Deno.test("overlayCss styles all overlay elements, click-transparent", () => {
  const css = overlayCss("#894c40");
  // Every overlay element must be in the FIRST rule (the shared base group):
  // that's what carries position:fixed + z-index — an element styled only by
  // its own rule renders as a static block at the end of <body>, off screen
  // (the intro card shipped invisible exactly that way once).
  const baseSelector = css.split("{")[0];
  for (const id of [CURSOR_ID, CAPTION_ID, INTRO_ID]) {
    assert.ok(
      baseSelector.includes(`#${id}`),
      `#${id} in the fixed-position base rule`,
    );
  }
  assert.ok(css.includes("position: fixed"));
  assert.ok(css.includes("pointer-events: none"));
  assert.ok(css.includes("#894c40"), "uses the actor accent");
});

Deno.test("introCardHtml carries title and per-actor identity + tagline, escaped", () => {
  const html = introCardHtml("Vertriebsoptimierung & Co", [
    {
      theme: ACTOR_THEMES.A,
      avatarDataUri: "data:image/png;base64,AAAA",
      tagline: 'Halle <"effizient">',
    },
    {
      theme: ACTOR_THEMES.B,
      avatarDataUri: "data:image/png;base64,BBBB",
      tagline: "fehlende Daten",
    },
  ]);
  assert.ok(html.includes("Vertriebsoptimierung &amp; Co"), "title escaped");
  assert.ok(html.includes("Alice Ahlmann") && html.includes("Bob Bauer"));
  assert.ok(html.includes("Ahlmann Logistik GmbH"));
  assert.ok(html.includes("Halle &lt;&quot;effizient&quot;&gt;"), "tagline escaped");
  assert.ok(html.includes(ACTOR_THEMES.B.accent), "per-actor accent");
  assert.ok(!html.includes('<"effizient">'), "no raw markup from taglines");
});

Deno.test("loadingCardHtml replicates the branded Loading… screen", () => {
  const html = loadingCardHtml("data:image/svg+xml;base64,LOGO");
  assert.ok(html.includes("data:image/svg+xml;base64,LOGO"), "G mark");
  assert.ok(html.includes("Loading…"), "ellipsis title, like ActivityScreen");
});

Deno.test("endCardHtml carries contact and both QR panels", () => {
  const html = endCardHtml({
    qrFauSvg: "<svg data-qr='fau'></svg>",
    qrIisSvg: "<svg data-qr='iis'></svg>",
  });
  assert.ok(html.includes("Thomas Wehr"));
  assert.ok(html.includes("thomas.wehr@fau.de"));
  assert.ok(html.includes("<svg data-qr='fau'>"), "FAU QR embedded verbatim");
  assert.ok(html.includes("<svg data-qr='iis'>"), "IIS QR embedded verbatim");
  assert.ok(html.includes("Granergize@FAU") && html.includes("Granergize@IIS"));
  // Funding acknowledgment — wording mirrors the handbuch (BMWE, IGF).
  assert.ok(html.includes("BMWE"), "funding body");
  assert.ok(html.includes("01IF23286N"), "Förderkennzeichen");
});

Deno.test("installOverlayScript is valid JS embedding the styles", () => {
  const script = installOverlayScript(ACTOR_THEMES.A);
  // Parse check only (no DOM here): an injection-broken template would throw.
  new Function(script);
  assert.ok(script.includes("demo-overlay-style"), "idempotence guard present");
  for (const id of [CURSOR_ID, CAPTION_ID, INTRO_ID]) {
    assert.ok(script.includes(id), `creates #${id}`);
  }
});

Deno.test("every actor theme is complete", () => {
  for (const slot of ["A", "B", "C"] as const) {
    const t = ACTOR_THEMES[slot];
    assert.strictEqual(t.slot, slot);
    assert.ok(t.name && t.company, `${slot} has name + company`);
    assert.match(t.accent, /^#[0-9a-f]{6}$/i);
  }
});

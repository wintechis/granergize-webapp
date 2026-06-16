/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { MESSAGES, translate } from "./messages.ts";

Deno.test("translate: resolves a plain message per language", () => {
  assert.equal(translate("en", "uiLanguage"), "Language");
  assert.equal(translate("de", "uiLanguage"), "Sprache");
  assert.equal(translate("fr", "uiLanguage"), "Langue");
});

Deno.test("translate: named-param interpolation", () => {
  assert.equal(translate("en", "buildingCount", { count: 3 }), "3 buildings");
});

Deno.test("translate: plural selection via Intl.PluralRules", () => {
  // English: distinct one/other.
  assert.equal(translate("en", "buildingCount", { count: 1 }), "1 building");
  assert.equal(translate("en", "buildingCount", { count: 5 }), "5 buildings");
  // French: 0 and 1 are 'one', 2+ 'other'.
  assert.equal(translate("fr", "buildingCount", { count: 1 }), "1 bâtiment");
  assert.equal(translate("fr", "buildingCount", { count: 2 }), "2 bâtiments");
  // German: one and other share a form here — both render "N Gebäude".
  assert.equal(translate("de", "buildingCount", { count: 1 }), "1 Gebäude");
  assert.equal(translate("de", "buildingCount", { count: 9 }), "9 Gebäude");
});

Deno.test("translate: a missing param is left visible, not dropped", () => {
  assert.equal(translate("en", "buildingCount", {}), "{count} buildings");
});

Deno.test("every catalog entry carries de/en/fr", () => {
  for (const [id, entry] of Object.entries(MESSAGES)) {
    for (const lang of ["de", "en", "fr"] as const) {
      assert.ok(
        (entry as Record<string, unknown>)[lang] != null,
        `${id} missing ${lang}`,
      );
    }
  }
});

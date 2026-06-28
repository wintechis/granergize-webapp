/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { MESSAGES, translate } from "./messages.ts";
import { navFinders } from "./messages/navFinders.ts";
import { buildingForms } from "./messages/buildingForms.ts";
import { energyRegional } from "./messages/energyRegional.ts";
import { buildingDetail } from "./messages/buildingDetail.ts";
import { cubeObservation } from "./messages/cubeObservation.ts";
import { shellAuth } from "./messages/shellAuth.ts";
import { detailRooms } from "./messages/detailRooms.ts";
import { dialogsShare } from "./messages/dialogsShare.ts";
import { notifications } from "./messages/notifications.ts";
import { landing } from "./messages/landing.ts";

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

Deno.test("the per-area slices partition the catalog — no id shadowed by a spread", () => {
  // MESSAGES is `{ ...sliceA, ...sliceB, ... }`, so a key duplicated across two
  // slices would silently override and shrink the merged catalog (and one surface
  // would unexpectedly read another's text). Guard: the slice key-counts must sum
  // to the merged key-count, i.e. the slices are a true partition.
  const slices = {
    navFinders,
    buildingForms,
    energyRegional,
    buildingDetail,
    cubeObservation,
    shellAuth,
    detailRooms,
    dialogsShare,
    notifications,
    landing,
  };
  const seen = new Map<string, string>();
  let total = 0;
  for (const [name, slice] of Object.entries(slices)) {
    for (const key of Object.keys(slice)) {
      total++;
      const prev = seen.get(key);
      assert.ok(!prev, `id "${key}" is in both ${prev} and ${name}`);
      seen.set(key, name);
    }
  }
  assert.equal(total, Object.keys(MESSAGES).length, "slice keys must sum to MESSAGES");
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

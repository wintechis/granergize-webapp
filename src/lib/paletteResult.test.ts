/// <reference lib="deno.ns" />
// Tier-1: the pure read-result summariser for the palette launcher.
import { strict as assert } from "node:assert";
import type { TFn } from "../context/I18nProvider.tsx";
import { summarizeReadResult } from "./paletteResult.ts";

// Identity `t` — the only i18n the summariser does is localise a dataset's labelId.
const t = ((id: string) => id) as unknown as TFn;

Deno.test("summarizeReadResult: FindNearbyInstallations → rows with kind + distance", () => {
  const value = [
    { iri: "x:1", label: "PV Nord", kind: "solar", lat: 0, long: 0, ags: "09", distanceKm: 1.234 },
    { iri: "x:2", label: "Windpark", kind: "wind", lat: 0, long: 0, ags: "09", distanceKm: 4 },
  ];
  const view = summarizeReadResult("FindNearbyInstallations", value, t);
  assert.equal(view.title, "2 nearby installations");
  assert.deepEqual(view.rows, [
    { primary: "PV Nord", secondary: "solar · 1.2 km" },
    { primary: "Windpark", secondary: "wind · 4.0 km" },
  ]);
});

Deno.test("summarizeReadResult: FindRegionalStatistics → metric label (t) + region", () => {
  const value = [
    { id: "a__09", tableId: "a", labelId: "regRenewableShare", ags: "09", region: "Bayern" },
  ];
  const view = summarizeReadResult("FindRegionalStatistics", value, t);
  assert.equal(view.title, "1 regional dataset");
  assert.deepEqual(view.rows, [{ primary: "regRenewableShare", secondary: "Bayern" }]);
});

Deno.test("summarizeReadResult: null → no result; unknown array → fallback labels", () => {
  assert.deepEqual(summarizeReadResult("Whatever", null, t), {
    title: "No result",
    rows: [],
  });
  const fb = summarizeReadResult("SharedWithMe", [{ name: "Acme" }, "plain"], t);
  assert.equal(fb.title, "2 results");
  assert.deepEqual(fb.rows, [{ primary: "Acme" }, { primary: "plain" }]);
});

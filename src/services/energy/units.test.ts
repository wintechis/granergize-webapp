/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { UNIT_NS } from "../rdf/vocabularies.ts";
import {
  displayMetric,
  fromCanonical,
  toCanonical,
  unitLabel,
} from "./units.ts";

const KWH = `${UNIT_NS}KiloW-HR`;
const MWH = `${UNIT_NS}MegaW-HR`;
const GWH = `${UNIT_NS}GigaW-HR`;
const WH = `${UNIT_NS}W-HR`;
const M3 = `${UNIT_NS}M3`;
const L = `${UNIT_NS}L`;

Deno.test("toCanonical: energy units fold to kWh", () => {
  assert.equal(toCanonical(5, MWH, KWH), 5000); // 5 MWh = 5000 kWh — the silent-bug case
  assert.equal(toCanonical(2, GWH, KWH), 2_000_000);
  assert.equal(toCanonical(5000, WH, KWH), 5);
  assert.equal(toCanonical(7, KWH, KWH), 7); // already canonical
});

Deno.test("toCanonical: a missing unit is assumed canonical; volume folds; unknown → null", () => {
  assert.equal(toCanonical(7, undefined, KWH), 7); // our own data writes the canonical unit
  assert.equal(toCanonical(500, L, M3), 0.5); // 500 L = 0.5 m³
  // An unrecognised unit is NOT guessed — null, so the caller skips it (no wrong number).
  assert.equal(toCanonical(5, `${UNIT_NS}BTU`, KWH), null);
});

Deno.test("fromCanonical + unitLabel: round-trip back to the raw unit for display", () => {
  assert.equal(fromCanonical(5000, MWH, KWH), 5);
  assert.equal(fromCanonical(7, KWH, KWH), 7);
  assert.equal(unitLabel(MWH), "MWh");
  assert.equal(unitLabel(M3), "m³");
  assert.equal(unitLabel(`${UNIT_NS}BTU`), "");
});

Deno.test("displayMetric: canonical by default, raw unit when recorded", () => {
  assert.deepEqual(displayMetric(5000, undefined, KWH), { value: 5000, label: "kWh" });
  assert.deepEqual(displayMetric(5000, KWH, KWH), { value: 5000, label: "kWh" });
  assert.deepEqual(displayMetric(5000, MWH, KWH), { value: 5, label: "MWh" });
});

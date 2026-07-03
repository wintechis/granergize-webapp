/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { systemSummary, systemValueLine } from "./systemDisplay.ts";
import type { TechnicalSystem } from "../types.ts";

Deno.test("systemSummary: capacity + commissioning year, kind-aware units", () => {
  assert.equal(
    systemSummary({ id: "a", kind: "pv", capacityKW: 63.45, commissioningYear: 2011 }),
    "63.45 kW, since 2011",
  );
  assert.equal(
    systemSummary({ id: "b", kind: "battery", storageCapacityKWh: 215.5 }),
    "215.5 kWh",
  );
  assert.equal(
    systemSummary({
      id: "c",
      kind: "chp",
      capacityKW: 120,
      thermalCapacityKW: 48,
    } as TechnicalSystem),
    "120 kW el, 48 kW th",
  );
  assert.equal(systemSummary({ id: "d", kind: "pv" }), "Yes");
});

Deno.test("systemValueLine: the name leads when the system has one", () => {
  const s: TechnicalSystem = {
    id: "a",
    kind: "pv",
    label: "Solaranlage Langguth",
    capacityKW: 63.45,
    commissioningYear: 2011,
  };
  assert.equal(systemValueLine(s), "Solaranlage Langguth · 63.45 kW, since 2011");
  assert.equal(
    systemValueLine({ id: "a", kind: "pv", capacityKW: 5 }),
    "5 kW",
  );
});

/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { Parser, Store } from "n3";
import type { BuildingType } from "../../../types/types.ts";
import {
  buildingsToXlsx,
  parseCsvToFields,
  serializeBuildingToTurtle,
} from "./buildingSerializer.ts";
import { INVESTOR_NS } from "./vocabularies.ts";

const FILE = "https://pod.example/granergize/buildings/b1.ttl";

// A building carrying all three object-property fields, stored as the human-readable
// LABELS the parser produces (e.g. tenancyType "Single Tenant", not "SingleTenant").
const building = {
  id: "b1",
  uri: `${FILE}#b1`,
  provenance: "investor",
  streetAddress: "Hauptstr 1",
  tenancyType: "Single Tenant",
  shiftRegime: "1-Shift",
  indoorTemperatureClass: "≤18 °C",
} as unknown as BuildingType;

Deno.test("generic XLSX round-trip normalizes object-property labels back to local names", async () => {
  // Export via the "Download all" flat-record path, then re-import generically.
  const bytes = buildingsToXlsx([building]);
  const file = new File([bytes], "buildings.xlsx");
  const parsed = await parseCsvToFields(file, "user");
  assert.equal(parsed.length, 1);

  // The importer must have normalized the labels back to controlled-vocab local names.
  assert.equal(parsed[0].tenancyType, "SingleTenant");
  assert.equal(parsed[0].shiftRegime, "OneShift");
  assert.equal(parsed[0].indoorTemperatureClass, "MaxEighteenDegrees");

  // Serializing the re-imported fields must yield VALID object IRIs (no spaces).
  const ttl = serializeBuildingToTurtle(parsed[0], FILE);
  const store = new Store(new Parser({ baseIRI: FILE }).parse(ttl));
  const tenancy = store.getObjects(null, `${INVESTOR_NS}tenancyType`, null)[0];
  assert.equal(tenancy?.value, `${INVESTOR_NS}SingleTenant`);
  assert.ok(!tenancy!.value.includes(" "), "object IRI has no embedded space");
});

/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { Parser, Store } from "n3";
import type { BuildingType } from "../../types.ts";
import {
  detectSpreadsheetFormat,
  parseCsvToFields,
  serializeBuildingToTurtle,
} from "./building/buildingSerializer.ts";
import { buildingsToXlsx, buildingToXlsx } from "./buildingWorkbook.ts";
import { BUILDING_NS } from "./vocabularies.ts";

const FILE = "https://pod.example/granergize/buildings/b1.ttl";

// A building carrying all three object-property fields, stored as the human-readable
// LABELS the parser produces (e.g. tenancyType "Single Tenant", not "SingleTenant").
const building = {
  id: "b1",
  uri: `${FILE}#b1`,
  streetAddress: "Hauptstr 1",
  tenancyType: "Single Tenant",
  shiftRegime: "1-Shift",
  indoorTemperatureClass: "≤18 °C",
} as unknown as BuildingType;

Deno.test("generic XLSX round-trip normalizes object-property labels back to local names", async () => {
  // Export via the "Download all" flat-record path, then re-import generically.
  const bytes = await buildingsToXlsx([building]);
  const file = new File([bytes], "buildings.xlsx");
  const parsed = await parseCsvToFields(file, "generic");
  assert.equal(parsed.length, 1);

  // The importer must have normalized the labels back to controlled-vocab local names.
  assert.equal(parsed[0].tenancyType, "SingleTenant");
  assert.equal(parsed[0].shiftRegime, "OneShift");
  assert.equal(parsed[0].indoorTemperatureClass, "MaxEighteenDegrees");

  // Serializing the re-imported fields must yield VALID object IRIs (no spaces).
  const ttl = serializeBuildingToTurtle(parsed[0], FILE);
  const store = new Store(new Parser({ baseIRI: FILE }).parse(ttl));
  const tenancy = store.getObjects(null, `${BUILDING_NS}tenancyType`, null)[0];
  assert.equal(tenancy?.value, `${BUILDING_NS}SingleTenant`);
  assert.ok(!tenancy!.value.includes(" "), "object IRI has no embedded space");
});

// The styled exports (exceljs: title band, header rows, logo drawing) must stay
// invisible to the import side — detection and re-import read cell values only.
// An exported building doubles as the import template, so each layout must both
// auto-detect and round-trip.

const styledBuilding = {
  id: "b9",
  uri: `${FILE}#b9`,
  buildingCode: "B-009",
  streetAddress: "Hauptstr 9",
  postalCode: "90402",
  locality: "Nürnberg",
  annualData: [
    { year: 2099, electricityConsumption: 12345, waterConsumption: 67 },
  ],
} as unknown as BuildingType;

Deno.test("styled investor export auto-detects and re-imports despite the title band", async () => {
  const bytes = await buildingToXlsx(styledBuilding, "investor");
  const file = new File([bytes], "building-b9.xlsx");

  assert.equal(await detectSpreadsheetFormat(file), "investor");

  const parsed = await parseCsvToFields(file, "investor");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].buildingCode, "B-009");
  assert.equal(parsed[0].streetAddress, "Hauptstr 9");
  assert.equal(parsed[0]._inv_elec_2099, "12345");
  assert.equal(parsed[0]._inv_water_2099, "67");
});

Deno.test("styled benchmark export auto-detects and re-imports via the header row", async () => {
  const bytes = await buildingToXlsx(styledBuilding, "benchmark");
  const file = new File([bytes], "building-b9.xlsx");

  assert.equal(await detectSpreadsheetFormat(file), "benchmark");

  const parsed = await parseCsvToFields(file, "benchmark");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].streetAddress, "Hauptstr 9");
  assert.equal(parsed[0]._bsp_elec, "12345");
});

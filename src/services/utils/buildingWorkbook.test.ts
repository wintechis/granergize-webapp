/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import * as XLSX from "xlsx";
import type { BuildingType } from "../../types.ts";
import { buildingsToXlsx, buildingToXlsx } from "./buildingWorkbook.ts";

/** Read the single "Gebäude" sheet back out of exported `.xlsx` bytes. */
function readSheet(bytes: ArrayBuffer): XLSX.WorkSheet {
  const wb = XLSX.read(new Uint8Array(bytes), { type: "array" });
  return wb.Sheets[wb.SheetNames[0]];
}

Deno.test("buildingToXlsx (investor) emits a row-label sheet with per-year energy + certs", () => {
  const b = {
    id: "b1",
    provenance: "investor",
    streetAddress: "Hauptstr 1",
    annualData: [
      { year: 2099, electricityConsumption: 22222, heatConsumption: 333 },
      { year: 2098, electricityConsumption: 11111 },
    ],
    operatingCosts: { insurance: "500" },
    certifications: [{ type: "DGNB", level: "Gold" }],
  } as unknown as BuildingType;

  // The investor sheet is a label-in-col-B / value-in-col-D layout (aoa rows of
  // ["", label, "", value]); read it as arrays and index by the label cell.
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(readSheet(buildingToXlsx(b)), {
    header: 1,
  });
  const byLabel = new Map(rows.map((r) => [r[1], r[3]]));

  assert.equal(byLabel.get("Stromverbrauch 2099"), 22222);
  assert.equal(byLabel.get("Stromverbrauch 2098"), 11111);
  assert.equal(byLabel.get("Wärme - tatsächlicher Verbrauch 2099"), 333);
  // A certification renders a yes-row plus its level row.
  assert.equal(byLabel.get("DGNB"), "Ja");
  // Empty figures are skipped entirely (no blank rows for 2098's heat).
  assert.ok(!byLabel.has("Wärme - tatsächlicher Verbrauch 2098"));
});

Deno.test("buildingToXlsx (benchmark) emits BSP energy headers in a single record row", () => {
  const b = {
    id: "b2",
    provenance: "benchmark_service_provider",
    streetAddress: "Werkstr 2",
    annualData: [
      { year: 2099, electricityConsumption: 4444, waterConsumption: 55 },
    ],
  } as unknown as BuildingType;

  const record = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    readSheet(buildingToXlsx(b)),
  )[0];
  assert.equal(record["Strom - tatsächlicher Verbrauch (kWh)"], 4444);
  assert.equal(record["Trinkwasser (m³)"], 55);
  // No wastewater figure → that column is absent (cellValue drops empties).
  assert.ok(!("Schmutzwasser (m³)" in record));
});

Deno.test("buildingsToXlsx emits one flat row per building keyed by field/intermediate names", () => {
  const buildings = [
    {
      id: "b1",
      provenance: "investor",
      streetAddress: "Hauptstr 1",
      annualData: [{ year: 2099, electricityConsumption: 22222 }],
    },
    {
      id: "b2",
      provenance: "user",
      streetAddress: "Nebenstr 2",
    },
  ] as unknown as BuildingType[];

  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    readSheet(buildingsToXlsx(buildings)),
  );
  assert.equal(records.length, 2);
  // Master data uses the BuildingType field names; energy uses the `_inv_*` keys.
  assert.equal(records[0].id, "b1");
  assert.equal(records[0].streetAddress, "Hauptstr 1");
  assert.equal(records[0]["_inv_elec_2099"], 22222);
  assert.equal(records[1].id, "b2");
});

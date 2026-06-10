/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import * as XLSX from "xlsx";
import { parseCsvToFields } from "./building/buildingSerializer.ts";

// The XLSX import fixtures in test/e2e/fixtures/ are synthetic stand-ins for
// the partner spreadsheets the import flow accepts (the e2e specs upload them
// through the Add-Building dialog). These tests prove they import via
// parseCsvToFields, and double as a guard that no real partner data leaks
// into them. (There is no downloadable template any more — exporting a demo
// building in the chosen layout IS the template.)

const DIR = "test/e2e/fixtures";
const REAL_PARTNER_STRINGS = [
  "Aurelis",
  "Panattoni",
  "Zufall",
  "LIP Invest",
  "ZP-87461",
  "Adam-von-Trott",
];

function fileOf(name: string): File {
  return new File([Deno.readFileSync(`${DIR}/${name}`)], name);
}

Deno.test("investor fixture imports three synthetic buildings", async () => {
  const parsed = await parseCsvToFields(fileOf("investor-import.xlsx"), "investor");
  assert.equal(parsed.length, 3);

  const b1 = parsed[0];
  assert.equal(b1.buildingCode, "B-001");
  assert.equal(b1.label, "Musterhausen");
  assert.equal(b1.streetAddress, "Industriestraße 1");
  assert.equal(b1.postalCode, "10115");
  assert.equal(b1.locality, "Berlin");
  assert.equal(b1.yearOfConstruction, "2015");
  // Per-year energy + renewable share attached to years with electricity.
  assert.equal(b1._inv_elec_2024, "505000");
  assert.equal(b1._inv_water_2024, "910");
  assert.equal(b1._inv_renew_2024, "15");
  // Operating costs (Servicelevel section) + certification (per system) import.
  assert.equal(b1._opcost_wasteDisposal, "Mittel");
  assert.equal(b1._opcost_insurance, "All-Risk");
  assert.equal(b1._cert_0_type, "DGNB");
  assert.equal(b1._cert_0_level, "Gold (ab 65%)");
});

Deno.test("Lastgang fixture imports a synthetic one-month load profile", async () => {
  const parsed = await parseCsvToFields(fileOf("lastgang-import.xlsx"), "generic");
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].label, "Beispiel Logistik Lager 1");

  // A full calendar month of 15-min readings (31 Berlin-days × 96 slots). The
  // volume is deliberate: the excel-import cancel e2e uploads this fixture one
  // day-file at a time, so a month's worth of writes gives the abort a real
  // in-flight upload to interrupt.
  const readings = JSON.parse(parsed[0]._readings_json) as Array<{ valueKwh: string; date: string }>;
  assert.equal(readings.length, 31 * 96);
  assert.ok(Number(readings[0].valueKwh) >= 0);
  // Berlin→UTC (−2h in CEST) spreads the month across 32 distinct UTC day-files.
  assert.equal(new Set(readings.map((r) => r.date)).size, 32);
});

Deno.test("import fixtures contain no real partner data", () => {
  for (const name of ["investor-import.xlsx", "lastgang-import.xlsx"]) {
    const wb = XLSX.read(Deno.readFileSync(`${DIR}/${name}`), { type: "array", raw: true });
    // Collect every sheet name and every cell value.
    const haystack: string[] = [...wb.SheetNames];
    for (const sn of wb.SheetNames) {
      const ws = wb.Sheets[sn];
      const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
      for (let r = range.s.r; r <= range.e.r; r++) {
        for (let c = range.s.c; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell?.v != null) haystack.push(String(cell.v));
        }
      }
    }
    const blob = haystack.join("\n");
    for (const s of REAL_PARTNER_STRINGS) {
      assert.ok(!blob.includes(s), `${name} still contains "${s}"`);
    }
  }
});

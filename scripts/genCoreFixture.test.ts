/// <reference lib="deno.ns" />
/**
 * Import contract for the bundled example workbooks, plus freshness for the one
 * artifact derived from them.
 *
 * The three workbooks under `public/examples/` are SOURCE files — hand-edited
 * spreadsheets, not codegen output — so there is nothing to compare them
 * against. What matters instead is that they keep parsing the way the app and
 * the test lanes expect: `detectSpreadsheetFormat` picks the intended layout,
 * `parseCsvToFields` yields the documented records, and every value survives
 * the importer's normalization. Those assertions ARE the contract; edit a sheet
 * in a way that breaks it and this test says so.
 *
 * `test/e2e/fixtures/limmo-core.xlsx` IS derived (`deno task gen:core-fixture`),
 * so it additionally gets a staleness check — against the L.Immo workbook it is
 * a subset of, and against an in-memory re-derivation. Xlsx bytes are not
 * stable across writes (zip/workbook timestamps), so both compare PARSED
 * records.
 */
import { strict as assert } from "node:assert";
import {
  CORE_CODES,
  CORE_OUT,
  coreSubset,
  LASTGANG_SRC,
  LIMMO_SRC,
  PORTFOLIO_SRC,
  readFlatRows,
  tableBytes,
} from "./genCoreFixture.ts";
import {
  detectSpreadsheetFormat,
  parseCsvToFields,
} from "../src/services/rdf/building/buildingImport.ts";
import type { SpreadsheetFormat } from "../src/services/xlsx/buildingTemplates.ts";
import { EXAMPLE_FILES } from "../src/constants/exampleFiles.ts";

async function parsed(
  bytes: Uint8Array,
  name: string,
  expectFormat: SpreadsheetFormat,
): Promise<Record<string, string>[]> {
  const file = new File([bytes.slice() as Uint8Array<ArrayBuffer>], name);
  assert.equal(await detectSpreadsheetFormat(file), expectFormat, name);
  return await parseCsvToFields(file, expectFormat);
}

const committed = (path: string) => Deno.readFile(path);

Deno.test("limmo example imports as 37 buildings with energy", async () => {
  const records = await parsed(await committed(LIMMO_SRC), LIMMO_SRC, "generic");
  assert.equal(records.length, 37);
  const codes = new Set(records.map((r) => r.buildingCode));
  assert.equal(codes.size, 37);
  for (const r of records) {
    assert.match(r.buildingCode, /^LI-\d+$/);
    for (const k of ["streetAddress", "postalCode", "locality", "lat", "long"]) {
      assert.ok(r[k], `${r.buildingCode} missing ${k}`);
    }
    assert.ok(
      Object.keys(r).filter((k) => k.startsWith("_inv_")).length >= 9,
      `${r.buildingCode} missing annual energy`,
    );
  }
  // Feature coverage: one generation building (the PV map lens needs data to
  // colour), the flagship's investor block (the detail-panel showcase).
  assert.equal(records.filter((r) => r._inv_gen_2024).length, 1);
  const flagship = records.find((r) => r.buildingCode === "LI-16074");
  assert.ok(flagship);
  assert.equal(flagship.streetAddress, "Thomas-Dachser-Str. 4");
  for (
    const k of [
      "leaseType",
      "shiftRegime",
      "_cert_0_type",
      "_opcost_propertyManagement",
      "_gasboiler_present",
      "_heatpump_present",
    ]
  ) {
    assert.ok(flagship[k], `flagship missing ${k}`);
  }
});

Deno.test("core fixture is a fresh subset of the limmo example", async () => {
  const source = await parsed(await committed(LIMMO_SRC), LIMMO_SRC, "generic");
  const records = await parsed(await committed(CORE_OUT), CORE_OUT, "generic");

  // Freshness against the source workbook: the fixture is EXACTLY the core rows
  // of the example the app ships (same order, same values) — so editing the
  // example without re-deriving is caught here.
  const wanted = new Set<string>(CORE_CODES);
  assert.deepEqual(
    records,
    source.filter((r) => wanted.has(r.buildingCode)),
    "core fixture is stale — run `deno task gen:core-fixture`",
  );
  // And against an in-memory re-derivation (guards the reshaper itself, not
  // just the two committed files agreeing).
  const rederived = await parsed(
    await tableBytes(coreSubset(readFlatRows(await committed(LIMMO_SRC)))),
    "rederived",
    "generic",
  );
  assert.deepEqual(records, rederived);

  assert.equal(records.length, CORE_CODES.length);
  const streets = records.map((r) => r.streetAddress);
  for (
    const s of [
      "Thomas-Dachser-Str. 4", // flagship: investor block
      "Steinauer Weg 7", // PV + `_inv_gen_*`
      "Am Tower 10", // the Lastgang example's address
      "Koperstr. 3",
    ]
  ) {
    assert.ok(streets.includes(s), `core fixture missing ${s}`);
  }
});

Deno.test("portfolio example imports the fictional four", async () => {
  const records = await parsed(
    await committed(PORTFOLIO_SRC),
    PORTFOLIO_SRC,
    "investor",
  );
  assert.equal(records.length, 4);
  assert.deepEqual(
    records.map((r) => r.buildingCode),
    ["NOP-84", "HAF-12", "LG-20", "PIR-68"],
  );
  const [nop, haf, lg, pir] = records;
  // German sheet values normalize to the stored tokens.
  assert.equal(nop.shiftRegime, "TwoShift");
  assert.equal(nop.tenancyType, "MultiTenant");
  assert.equal(nop.indoorTemperatureClass, "MaxEighteenDegrees");
  assert.equal(nop._cert_0_type, "DGNB");
  assert.equal(nop._cert_0_level, "Gold");
  assert.equal(nop._inv_elec_2022, "118000");
  assert.equal(haf._cert_0_type, "LEED");
  assert.equal(haf.indoorTemperatureClass, "MaxTwelveDegrees");
  // No coordinates in the investor layout — this file demonstrates
  // geocode-on-import.
  for (const r of records) {
    assert.ok(!r.lat && !r.long, `${r.buildingCode} unexpectedly has coords`);
  }
  assert.ok(lg._inv_elec_2023 && lg._inv_water_2024);
  assert.ok(!Object.keys(pir).some((k) => k.startsWith("_inv_")));
});

Deno.test("lastgang example parses to the 14-day series", async () => {
  const records = await parsed(
    await committed(LASTGANG_SRC),
    LASTGANG_SRC,
    "generic",
  );
  assert.equal(records.length, 1);
  const rec = records[0];
  assert.equal(rec.label, "Am Tower 10");
  const readings = JSON.parse(rec._readings_json) as Array<
    { date: string; beginTs: string; valueKwh: string }
  >;
  assert.equal(readings.length, 14 * 96);
  assert.equal(readings[0].beginTs, "2024-06-01T00:00:00Z");
  assert.equal(new Set(readings.map((r) => r.date)).size, 14);
  // Weekend days are scaled down (the weekday/weekend shape is what makes the
  // Day View / Daily Totals / Average Profile surfaces meaningful).
  const daily = new Map<string, number>();
  for (const r of readings) {
    daily.set(r.date, (daily.get(r.date) ?? 0) + parseFloat(r.valueKwh));
  }
  assert.ok(
    daily.get("2024-06-02")! < daily.get("2024-06-03")! * 0.7,
    "Sunday should be well below Monday",
  );
});

Deno.test("EXAMPLE_FILES entries match the bundled workbooks", async () => {
  // Every file the dialog offers exists, and every self-operated/self-owned
  // mark targets a building code the file actually parses to (a stale code
  // would silently drop the operator group the Betreiber benchmark needs).
  const byName: Record<string, string> = {
    "limmo-nuernberg.xlsx": LIMMO_SRC,
    "beispiel-portfolio.xlsx": PORTFOLIO_SRC,
    "lastgang-am-tower-10.xlsx": LASTGANG_SRC,
  };
  assert.deepEqual(
    EXAMPLE_FILES.map((e) => e.file).sort(),
    Object.keys(byName).sort(),
  );
  for (const entry of EXAMPLE_FILES) {
    const bytes = await committed(byName[entry.file]);
    const file = new File([bytes.slice() as Uint8Array<ArrayBuffer>], entry.file);
    const records = await parseCsvToFields(
      file,
      await detectSpreadsheetFormat(file),
    );
    const codes = new Set(records.map((r) => r.buildingCode).filter(Boolean));
    for (const marks of [entry.selfOperatedCodes, entry.selfOwnedCodes]) {
      if (!marks || marks === "all") continue;
      for (const code of marks) {
        assert.ok(codes.has(code), `${entry.id}: unknown code ${code}`);
      }
    }
    if (entry.id === "lastgang") {
      // The prefill must make the one parsed building saveable (address +
      // coordinates are the required fields).
      for (const k of ["streetAddress", "postalCode", "locality", "lat", "long"]) {
        assert.ok(entry.prefill?.[k], `lastgang prefill missing ${k}`);
      }
    }
  }
});

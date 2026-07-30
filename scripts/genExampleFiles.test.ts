/// <reference lib="deno.ns" />
/**
 * Freshness + import-contract test for the bundled example workbooks
 * (`scripts/genExampleFiles.ts`). Xlsx bytes are not stable across writes
 * (zip/workbook timestamps), so freshness compares what actually matters: the
 * PARSED field records of the committed artifact vs an in-memory regeneration.
 * Because the comparison runs through `detectSpreadsheetFormat` +
 * `parseCsvToFields`, the same assertions double as the import contract for
 * every file the app offers under "Try an example file".
 */
import { strict as assert } from "node:assert";
import {
  buildSpecs,
  CORE_IDS,
  CORE_OUT,
  LASTGANG_DAYS,
  LASTGANG_LABEL,
  LASTGANG_OUT,
  lastgangBytes,
  LIMMO_OUT,
  limmoBytes,
  PORTFOLIO_OUT,
  portfolioBytes,
  readRows,
  XLSX_PATH,
  yearFromRange,
} from "./genExampleFiles.ts";
import { FICTIONAL_EXAMPLES } from "./data/fictionalExamples.ts";
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

Deno.test("limmo example is fresh and re-imports the full spec set", async () => {
  const specs = buildSpecs(readRows(await Deno.readFile(XLSX_PATH)));
  const records = await parsed(await committed(LIMMO_OUT), LIMMO_OUT, "generic");
  // The committed file parses to EXACTLY the specs (fields + annual merged):
  // fresh against the source extract AND every value survives the importer's
  // normalization untouched.
  assert.deepEqual(
    records,
    specs.map((s) => ({ ...s.fields, ...s.annual })),
    "committed workbook is stale — run `deno task gen:examples`",
  );
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
  // Feature coverage: one generation building (PV lens), the flagship's
  // investor block (detail-panel showcase).
  assert.equal(records.filter((r) => r._inv_gen_2024).length, 1);
  const flagship = records.find((r) => r.buildingCode === "LI-16074");
  assert.ok(flagship);
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

Deno.test("core fixture is fresh and carries the spec-targeted buildings", async () => {
  const specs = buildSpecs(readRows(await Deno.readFile(XLSX_PATH)));
  const coreCodes = new Set(CORE_IDS.map((id) => `LI-${id}`));
  const core = specs.filter((s) => coreCodes.has(s.fields.buildingCode));
  const records = await parsed(await committed(CORE_OUT), CORE_OUT, "generic");
  assert.deepEqual(
    records,
    core.map((s) => ({ ...s.fields, ...s.annual })),
    "core fixture is stale — run `deno task gen:examples`",
  );
  assert.equal(records.length, 6);
  const streets = records.map((r) => r.streetAddress);
  for (
    const s of [
      "Thomas-Dachser-Str. 4",
      "Steinauer Weg 7",
      "Am Tower 10",
      "Koperstr. 3",
    ]
  ) {
    assert.ok(streets.includes(s), `core fixture missing ${s}`);
  }
});

Deno.test("portfolio example is fresh and re-imports the fictional set", async () => {
  const fromCommitted = await parsed(
    await committed(PORTFOLIO_OUT),
    PORTFOLIO_OUT,
    "investor",
  );
  const fromMemory = await parsed(
    await portfolioBytes(FICTIONAL_EXAMPLES),
    "regenerated",
    "investor",
  );
  assert.deepEqual(
    fromCommitted,
    fromMemory,
    "portfolio workbook is stale — run `deno task gen:examples`",
  );
  assert.equal(fromCommitted.length, 4);
  assert.deepEqual(
    fromCommitted.map((r) => r.buildingCode),
    ["NOP-84", "HAF-12", "LG-20", "PIR-68"],
  );
  const [nop, haf, lg, pir] = fromCommitted;
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
  for (const r of fromCommitted) {
    assert.ok(!r.lat && !r.long, `${r.buildingCode} unexpectedly has coords`);
  }
  assert.ok(lg._inv_elec_2023 && lg._inv_water_2024);
  assert.ok(!Object.keys(pir).some((k) => k.startsWith("_inv_")));
});

Deno.test("lastgang example is fresh and parses to the 14-day series", async () => {
  const fromCommitted = await parsed(
    await committed(LASTGANG_OUT),
    LASTGANG_OUT,
    "generic",
  );
  const fromMemory = await parsed(await lastgangBytes(), "regenerated", "generic");
  assert.deepEqual(
    fromCommitted,
    fromMemory,
    "lastgang workbook is stale — run `deno task gen:examples`",
  );
  assert.equal(fromCommitted.length, 1);
  const rec = fromCommitted[0];
  assert.equal(rec.label, LASTGANG_LABEL);
  const readings = JSON.parse(rec._readings_json) as Array<
    { date: string; beginTs: string; valueKwh: string }
  >;
  assert.equal(readings.length, LASTGANG_DAYS * 96);
  assert.equal(readings[0].beginTs, "2024-06-01T00:00:00Z");
  assert.equal(new Set(readings.map((r) => r.date)).size, LASTGANG_DAYS);
  // Weekend days are scaled down (the weekday/weekend factor survives).
  const daily = new Map<string, number>();
  for (const r of readings) {
    daily.set(r.date, (daily.get(r.date) ?? 0) + parseFloat(r.valueKwh));
  }
  assert.ok(
    daily.get("2024-06-02")! < daily.get("2024-06-03")! * 0.7,
    "Sunday should be well below Monday",
  );
});

Deno.test("limmo example equals its in-memory regeneration", async () => {
  const specs = buildSpecs(readRows(await Deno.readFile(XLSX_PATH)));
  const fromCommitted = await parsed(await committed(LIMMO_OUT), LIMMO_OUT, "generic");
  const fromMemory = await parsed(await limmoBytes(specs), "regenerated", "generic");
  assert.deepEqual(fromCommitted, fromMemory);
});

Deno.test("EXAMPLE_FILES entries match the emitted artifacts", async () => {
  // Every file the dialog offers exists as a committed artifact, and every
  // self-operated/self-owned mark targets a building code the file actually
  // parses to (a stale code would silently drop the operator group the
  // Betreiber benchmark needs).
  const byName: Record<string, string> = {
    "limmo-nuernberg.xlsx": LIMMO_OUT,
    "beispiel-portfolio.xlsx": PORTFOLIO_OUT,
    "lastgang-am-tower-10.xlsx": LASTGANG_OUT,
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
    for (
      const marks of [entry.selfOperatedCodes, entry.selfOwnedCodes]
    ) {
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

Deno.test("yearFromRange maps range start and omits open lower bounds", () => {
  assert.equal(yearFromRange("2001-2005"), 2001);
  assert.equal(yearFromRange("2021-2025"), 2021);
  assert.equal(yearFromRange("<1990"), null);
});

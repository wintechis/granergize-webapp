/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import * as XLSX from "xlsx";
import { DataFactory, Parser, Store } from "n3";
import {
  generateEnergyDayTtl,
  type LastgangReading,
  parseLastgangXlsx,
  synthDayReadings,
} from "./energySeriesXlsx.ts";
import { CONSUMPTION_NS } from "./vocabularies.ts";

const { namedNode } = DataFactory;
const RDF_TYPE = namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
const READING = namedNode(`${CONSUMPTION_NS}EnergyConsumptionReading`);

/** aoa_to_sheet + its decoded range, the two args parseLastgangXlsx consumes. */
function sheet(rows: (string | number | null)[][]): [XLSX.WorkSheet, XLSX.Range] {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  return [ws, XLSX.utils.decode_range(ws["!ref"]!)];
}

Deno.test("synthDayReadings yields 96 UTC slots with a midnight base load", () => {
  const out = synthDayReadings("2024-03-10");
  assert.equal(out.length, 96);
  // Slot 0 is 00:00–00:15 UTC; the load curve's base (12 kW) → 12 × 0.25 = 3 kWh.
  assert.equal(out[0].date, "2024-03-10");
  assert.equal(out[0].slotId, "0000");
  assert.equal(out[0].beginTs, "2024-03-10T00:00:00Z");
  assert.equal(out[0].endTs, "2024-03-10T00:15:00Z");
  assert.equal(out[0].valueKwh, "3.000000");
  // Midday is busier than midnight (the daytime bump), and slots are contiguous.
  const peak = Math.max(...out.map((r) => Number(r.valueKwh)));
  assert.ok(peak > 3, "a daytime slot exceeds the base load");
  assert.equal(out[95].slotId, "2345");
});

Deno.test("parseLastgangXlsx parses the col-A-timestamp format (CEST → UTC)", () => {
  // Header row (label→value) then two end-of-interval rows in Europe/Berlin local
  // time. July is CEST (UTC+2): a 12:00 end-of-interval is 10:00Z, so the 15-min
  // slot begins 09:45Z.
  const [ws, range] = sheet([
    ["Marktlokation Name", "Building X"],
    ["15.7.2024 12:00", 40],
    ["15.7.2024 12:15", 80],
  ]);
  const out = parseLastgangXlsx(ws, range);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "Building X");
  const readings: LastgangReading[] = JSON.parse(out[0]._readings_json);
  assert.equal(readings.length, 2);
  assert.equal(readings[0].beginTs, "2024-07-15T09:45:00Z");
  assert.equal(readings[0].endTs, "2024-07-15T10:00:00Z");
  assert.equal(readings[0].date, "2024-07-15");
  assert.equal(readings[0].slotId, "0945");
  assert.equal(readings[0].valueKwh, "10.000000"); // 40 kW × 0.25 h
  assert.equal(readings[1].valueKwh, "20.000000"); // 80 kW × 0.25 h
});

Deno.test("parseLastgangXlsx parses the old empty-col-A format (CET → UTC)", () => {
  // January is CET (UTC+1): a 12:00 end-of-interval is 11:00Z, slot begins 10:45Z.
  const [ws, range] = sheet([
    [null, "15.1.2024 12:00", 40],
  ]);
  const out = parseLastgangXlsx(ws, range);
  assert.equal(out.length, 1);
  const readings: LastgangReading[] = JSON.parse(out[0]._readings_json);
  assert.equal(readings.length, 1);
  assert.equal(readings[0].beginTs, "2024-01-15T10:45:00Z");
  assert.equal(readings[0].endTs, "2024-01-15T11:00:00Z");
});

Deno.test("parseLastgangXlsx returns [] for a sheet with no readings (not Lastgang)", () => {
  const [ws, range] = sheet([
    ["Marktlokation Name", "Building Y"],
    ["Some other label", "value"],
  ]);
  assert.deepEqual(parseLastgangXlsx(ws, range), []);
});

Deno.test("generateEnergyDayTtl emits one valid reading per slot", () => {
  const readings = synthDayReadings("2024-06-01").slice(0, 3);
  const ttl = generateEnergyDayTtl(
    "2024-06-01",
    readings,
    "https://pod.example/granergize/buildings/b1.ttl#b1",
    "Building Z",
  );
  const store = new Store(
    new Parser({ baseIRI: "https://pod.example/x.ttl" }).parse(ttl),
  );
  const subjects = store.getSubjects(RDF_TYPE, READING, null);
  assert.equal(subjects.length, 3, "one EnergyConsumptionReading per slot");
  // Each reading carries its own simple-result triple (getQuads keeps duplicate
  // object values, unlike getObjects which dedupes the identical base-load kWh).
  const results = store.getQuads(
    null,
    namedNode("http://www.w3.org/ns/sosa/hasSimpleResult"),
    null,
    null,
  );
  assert.equal(results.length, 3, "one simple result per reading");
});

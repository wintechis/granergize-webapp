import * as XLSX from "xlsx";
import { CONSUMPTION_NS } from "./vocabularies.ts";

// ---------------------------------------------------------------------------
// Lastgang (15-min load profile) helpers — parse a utility load-profile XLSX
// (Europe/Berlin timestamps, DST-aware) into UTC 15-minute readings, and
// serialize a day of readings to Turtle. Split out of buildingSerializer.
// ---------------------------------------------------------------------------

export interface LastgangReading {
  date: string;     // "YYYY-MM-DD" UTC date of begin time
  slotId: string;   // "HHMM" of begin UTC
  beginTs: string;  // ISO 8601 UTC
  endTs: string;    // ISO 8601 UTC
  valueKwh: string; // kW × 0.25, 6 decimal places
}

function lastSundayOf(year: number, month: number): number {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastDow = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return lastDay - lastDow;
}

function berlinToUTC(
  year: number, month: number, day: number, hour: number, minute: number,
): Date {
  const dstStart = Date.UTC(year, 2, lastSundayOf(year, 3), 1, 0, 0);
  const dstEnd   = Date.UTC(year, 9, lastSundayOf(year, 10), 1, 0, 0);
  const asCEST   = Date.UTC(year, month - 1, day, hour - 2, minute);
  if (asCEST >= dstStart && asCEST < dstEnd) return new Date(asCEST);
  return new Date(Date.UTC(year, month - 1, day, hour - 1, minute));
}

function toISO8601(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Convert an Excel serial date number to {year,month,day,hour,minute} (local time). */
function xlSerialToComponents(serial: number): { year: number; month: number; day: number; hour: number; minute: number } {
  // Excel counts from Jan 1 1900 as day 1, but incorrectly treats 1900 as leap year.
  // For serials >= 60 (i.e. March 1, 1900+) subtract 1 to correct.
  const adjusted = serial >= 60 ? serial - 1 : serial;
  const ms = (adjusted - 1) * 86400000;
  const d = new Date(Date.UTC(1900, 0, 1) + ms);
  const frac = serial - Math.floor(serial);
  const totalMin = Math.round(frac * 1440);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: Math.floor(totalMin / 60),
    minute: totalMin % 60,
  };
}

/** Lastgang header label → BuildingType field name. */
const LASTGANG_FIELD_MAP: Record<string, string> = {
  "Marktlokation Name": "label",
};

/**
 * Parse an end-of-interval timestamp string to {year, month, day, hour, minute}.
 * Accepts:
 *   US format:     M/D/YYYY H:MM  or  MM/DD/YYYY HH:MM
 *   German format: D.M.YYYY H:MM  or  DD.MM.YYYY HH:MM
 *   ISO format:    YYYY-MM-DDTHH:MM  or  YYYY-MM-DD HH:MM  (timezone suffix ignored)
 */
function parseEndOfIntervalTs(
  tsStr: string,
): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const clean = tsStr.trim();
  // ISO: YYYY-MM-DDTHH:MM or YYYY-MM-DD HH:MM (optional seconds / timezone suffix)
  const iso = clean.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (iso) return { year: +iso[1], month: +iso[2], day: +iso[3], hour: +iso[4], minute: +iso[5] };
  // US: M/D/YYYY H:MM or M/D/YY H:MM
  const us = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})/);
  if (us) {
    const y = +us[3];
    return { month: +us[1], day: +us[2], year: y < 100 ? 2000 + y : y, hour: +us[4], minute: +us[5] };
  }
  // German: D.M.YYYY H:MM
  const de = clean.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (de) return { day: +de[1], month: +de[2], year: +de[3], hour: +de[4], minute: +de[5] };
  return null;
}

/** Get the best timestamp string from a cell (formatted text preferred, serial fallback). */
function cellTimestamp(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  // Use formatted text only if it actually looks like a date (not a raw serial like "45292.010")
  if (cell.w) {
    const w = String(cell.w).trim();
    if (/\d{1,4}[-./T]\d{1,2}/.test(w)) return w;
  }
  // Excel serial date number (date-formatted cells)
  if (cell.t === "n" && typeof cell.v === "number" && cell.v > 25000) {
    const { year, month, day, hour, minute } = xlSerialToComponents(cell.v);
    return `${day}.${String(month).padStart(2, "0")}.${year} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  return cell.v != null ? String(cell.v) : "";
}

/**
 * Parse a Lastgang XLSX worksheet:
 *   rows with col A non-empty = header block (label → value pairs)
 *   rows with col A empty, col B = end-of-interval timestamp (Europe/Berlin),
 *   col C = average power (kW) → 15-min readings
 *
 * Returns a single-element array with one building field map.
 * Energy readings are stored as JSON in `_readings_json`.
 * Returns [] if no readings could be parsed (signals: not Lastgang format).
 */
export function parseLastgangXlsx(ws: XLSX.WorkSheet, range: XLSX.Range): Record<string, string>[] {
  const fields: Record<string, string> = {};
  const readings: LastgangReading[] = [];

  for (let r = range.s.r; r <= range.e.r; r++) {
    const cellA = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    const cellB = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    const cellC = ws[XLSX.utils.encode_cell({ r, c: 2 })];

    const labelA = cellA?.v != null ? String(cellA.v).trim() : "";

    if (!labelA) {
      // Old format: col A empty, col B = end-of-interval timestamp, col C = kW value
      const tsStr = cellTimestamp(cellB);
      if (!tsStr) continue;
      const ts = parseEndOfIntervalTs(tsStr);
      if (!ts) continue;
      const endUTC = berlinToUTC(ts.year, ts.month, ts.day, ts.hour, ts.minute);
      const beginUTC = new Date(endUTC.getTime() - 15 * 60 * 1000);
      const kwRaw = cellC?.v != null ? cellC.v : null;
      if (kwRaw == null) continue;
      const kw = parseFloat(typeof kwRaw === "string" ? kwRaw.replace(",", ".") : String(kwRaw));
      if (isNaN(kw)) continue;
      const beginTs = toISO8601(beginUTC);
      readings.push({
        date:     beginTs.slice(0, 10),
        slotId:   beginTs.slice(11, 16).replace(":", ""),
        beginTs,
        endTs:    toISO8601(endUTC),
        valueKwh: (kw * 0.25).toFixed(6),
      });
      continue;
    }

    // Col A non-empty: try parsing as end-of-interval timestamp (Lastgang format:
    // col A = timestamp, col B = kW value). Fall back to header row if not a timestamp.
    const tsStrA = cellTimestamp(cellA);
    const ts = parseEndOfIntervalTs(tsStrA);
    if (ts) {
      const endUTC = berlinToUTC(ts.year, ts.month, ts.day, ts.hour, ts.minute);
      const beginUTC = new Date(endUTC.getTime() - 15 * 60 * 1000);
      const kwRaw = cellB?.v != null ? cellB.v : null;
      if (kwRaw == null) continue;
      const kw = parseFloat(typeof kwRaw === "string" ? kwRaw.replace(",", ".") : String(kwRaw));
      if (isNaN(kw)) continue;
      const beginTs = toISO8601(beginUTC);
      readings.push({
        date:     beginTs.slice(0, 10),
        slotId:   beginTs.slice(11, 16).replace(":", ""),
        beginTs,
        endTs:    toISO8601(endUTC),
        valueKwh: (kw * 0.25).toFixed(6),
      });
    } else {
      // Header row: col A = label, col B = value
      const field = LASTGANG_FIELD_MAP[labelA];
      if (field && cellB?.v != null) fields[field] = String(cellB.v).trim();
    }
  }

  if (readings.length === 0) return [];

  fields["_readings_json"] = JSON.stringify(readings);
  return [fields];
}

/** Generate Turtle content for one day of 15-min energy readings. */
export function generateEnergyDayTtl(
  date: string,
  readings: LastgangReading[],
  buildingSubjectUri: string,
  label: string,
): string {
  const blocks = readings
    .map(
      (r) =>
        `:r_${r.slotId} a cons:EnergyConsumptionReading ;\n` +
        `    sosa:observedProperty cons:ElectricityConsumption ;\n` +
        `    sosa:hasFeatureOfInterest <${buildingSubjectUri}> ;\n` +
        `    sosa:hasResult [ a sosa:Result ; sosa:hasSimpleResult "${r.valueKwh}"^^xsd:decimal ; ssn:hasUnit unit:KiloW-HR ] ;\n` +
        `    sosa:phenomenonTime [ a time:Interval ; time:hasBeginning "${r.beginTs}"^^xsd:dateTime ; time:hasEnd "${r.endTs}"^^xsd:dateTime ] .`,
    )
    .join("\n\n");

  return (
    `@prefix : <#> .\n` +
    `@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .\n` +
    `@prefix sosa: <http://www.w3.org/ns/sosa/> .\n` +
    `@prefix ssn: <http://www.w3.org/ns/ssn/> .\n` +
    `@prefix time: <http://www.w3.org/2006/time#> .\n` +
    `@prefix unit: <https://qudt.org/vocab/unit#> .\n` +
    `@prefix cons: <${CONSUMPTION_NS}> .\n` +
    `\n# 15-minute energy readings — ${date} (UTC)\n` +
    `# ${label}\n` +
    `# ${readings.length} reading(s)\n\n` +
    blocks + "\n"
  );
}

/** A representative day of synthetic 15-minute readings (96 slots, UTC) with a
 * simple daytime-peaked load curve. Used for the "series" demo building. */
export function synthDayReadings(date: string): LastgangReading[] {
  const dayStart = new Date(`${date}T00:00:00Z`).getTime();
  const out: LastgangReading[] = [];
  for (let slot = 0; slot < 96; slot++) {
    const begin = new Date(dayStart + slot * 15 * 60 * 1000);
    const end = new Date(begin.getTime() + 15 * 60 * 1000);
    const hour = begin.getUTCHours() + begin.getUTCMinutes() / 60;
    // Base load + a daytime bump peaking ~midday; never negative.
    const kw = 12 + 18 * Math.max(0, Math.sin(((hour - 6) / 24) * 2 * Math.PI));
    const beginTs = toISO8601(begin);
    out.push({
      date: beginTs.slice(0, 10),
      slotId: beginTs.slice(11, 16).replace(":", ""),
      beginTs,
      endTs: toISO8601(end),
      valueKwh: (kw * 0.25).toFixed(6),
    });
  }
  return out;
}

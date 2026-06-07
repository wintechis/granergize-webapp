// Regenerate the public Excel import templates with SYNTHETIC data.
//
// The originals shipped in public/templates/ were real partner spreadsheets
// (real company names, addresses, metering codes and consumption). This script
// rebuilds them so the downloadable templates keep the same visible STRUCTURE
// and STYLE (sheet layout, category/field/unit columns, header rows, units)
// while containing only fictional example data.
//
// Leak-safety: every output sheet is built fresh from a whitelist of cells —
// the investor label skeleton (cols A–C: Kategorie/Datenfeld/Einheit), the BSP
// header row, and hardcoded Lastgang labels — plus synthetic data we write
// here. No cell from the originals' data columns, no formulas, defined names or
// cached values are carried over. Reading the first sheet's label columns is
// idempotent: re-running against an already-regenerated file reproduces the
// same output (labels are identical), so it does not depend on the originals
// staying present.
//
// Run:  deno run -A excel/gen-templates.ts
//
// Import compatibility is asserted by buildingSerializer's parseCsvToFields and
// covered by src/services/utils/templates.test.ts.

import * as XLSX from "xlsx";

const DIR = "public/templates";

// --- helpers ---------------------------------------------------------------

function readWb(path: string): XLSX.WorkBook {
  return XLSX.read(Deno.readFileSync(path), { type: "array", raw: true });
}

function cell(ws: XLSX.WorkSheet, r: number, c: number): string {
  const x = ws[XLSX.utils.encode_cell({ r, c })];
  return x?.v != null ? String(x.v) : "";
}

function writeWb(wb: XLSX.WorkBook, name: string): void {
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const u8 = out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
  Deno.writeFileSync(`${DIR}/${name}`, u8);
  console.log(`wrote ${DIR}/${name} (${u8.byteLength} bytes)`);
}

/** Re-emit a worksheet keeping values only (drops styles/formulas/defined names). */
function sheetValuesOnly(ws: XLSX.WorkSheet): XLSX.WorkSheet {
  const aoa = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: true });
  return XLSX.utils.aoa_to_sheet(aoa);
}

// --- synthetic example buildings (fully fictional) -------------------------
// Three example logistics properties of one example investor company. Cities are
// real (not identifying); company name and streets are invented.

const COMPANY = "Beispiel Logistik GmbH";

// Investor sheet: column-B label -> [value building 1, 2, 3].
// Only rows the importer reads (INVESTOR_ROW_MAP + the per-year energy rows +
// Unternehmen/Sichtweise) are filled; other descriptive rows stay blank, as in
// the original. Labels must match the sheet's col-B text exactly.
const INV: Record<string, [string, string, string]> = {
  "Unternehmen": [COMPANY, COMPANY, COMPANY],
  "Sichtweise": ["Investor", "Investor", "Investor"],
  "Gebäude-Code": ["B-001", "B-002", "B-003"],
  "Gebäude-Name": ["Musterhausen", "Beispielstadt", "Logistikheim"],
  "Straße": ["Industriestraße 1", "Am Gewerbepark 12", "Lagerweg 5"],
  "PLZ": ["10115", "80331", "20095"],
  "Ort": ["Berlin", "München", "Hamburg"],
  "Bundesland": ["Berlin", "Bayern", "Hamburg"],
  "Höhe": ["11.5", "10", "9.2"],
  "Schichtregime": ["2 Schicht", "3 Schicht", "1 Schicht"],
  "Anzahl Mieter": ["Single", "Single", "Multi-Tenant"],
  "Mietvertragsart": ["Double-Net", "Double-Net", "Double-Net"],
  "Hauptindustrie des Mieters / Nutzers (Branche)": [
    "Sonstiges",
    "Elektronik",
    "Lebensmittel und Getränke / Frischelogistik",
  ],
  "Innenraumtemperatur": ["<= 18°C", "<= 18°C", "<= 12°C"],
  "Baujahr": ["2015", "2019", "2008"],
  "Sanierungsjahr": ["", "2021", ""],
  "Ladetore": ["40", "28", "52"],
  "Grundstücksfläche": ["45000", "32000", "51000"],
  "Hallenfläche": ["20000", "14500", "23800"],
  "Büro- &Sozialfläche": ["1200", "850", "1500"],
  "PV-Anlage installiert": ["Ja", "Nein", "Ja"],
  "Ölkessel": ["Nein", "Nein", "Nein"],
  "Gaskessel": ["Ja", "Ja", "Nein"],
  "Stromkessel": ["Nein", "Nein", "Nein"],
  "Wärmepumpe": ["Nein", "Nein", "Ja"],
  "Fernwärme": ["Nein", "Ja", "Nein"],
  "Stromverbrauch 2022": ["520000", "410000", "680000"],
  "Stromverbrauch 2023": ["498000", "405000", "712000"],
  "Stromverbrauch 2024": ["505000", "399000", "700000"],
  "Wärme - tatsächlicher Verbrauch 2022": ["310000", "260000", ""],
  "Wärme - tatsächlicher Verbrauch 2023": ["305000", "255000", ""],
  "Wärme - tatsächlicher Verbrauch 2024": ["300000", "250000", ""],
  "Wasserverbrauch 2022": ["900", "700", "1200"],
  "Wasserverbrauch 2023": ["880", "690", "1180"],
  "Wasserverbrauch 2024": ["910", "705", "1205"],
  "Anteil eigenerzeugter Strom aus erneuerbaren Quellen": ["15", "0", "8"],
  // Operating costs (Servicelevel section — categorical service levels).
  "Entsorgung": ["Mittel", "Mittel", "Hoch"],
  "Versicherung": ["All-Risk", "All-Risk", "All-Risk"],
  "Verwaltung": ["Mittel", "Mittel", "Hoch"],
  "Hausmeister": ["Hoch", "Einfach", "Mittel"],
  // Certifications (per system: yes/no + level).
  "Zertifizierung vorhanden?": ["Ja", "Ja", "Nein"],
  "DGNB": ["Ja", "Ja", "Nein"],
  "DGNB Zertifizierungsstufe": ["Gold (ab 65%)", "Silber (ab 50%)", ""],
  "BREEAM": ["Nein", "Nein", "Nein"],
  "LEED": ["Nein", "Nein", "Nein"],
};

// --- investor template -----------------------------------------------------

function genInvestor(): void {
  const src = readWb(`${DIR}/investor-template.xlsx`);
  const ws = src.Sheets[src.SheetNames[0]]; // label skeleton (cols A–C), idempotent
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");

  const aoa: (string | number)[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const a = cell(ws, r, 0); // Kategorie
    const b = cell(ws, r, 1); // Datenfeld (label)
    const c = cell(ws, r, 2); // Einheit
    const row: string[] = [a, b, c];
    if (a === "Kategorie") {
      row.push("Eingabe", "Eingabe", "Eingabe"); // header row of the input columns
    } else if (INV[b]) {
      row.push(...INV[b]);
    }
    aoa.push(row);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Verbrauchsdaten");
  // Carry over the generic reference sheets (vocab lists / quality matrix) —
  // they contain no partner data.
  for (const name of ["Listen", "Gebäudequalität"]) {
    if (src.Sheets[name]) {
      XLSX.utils.book_append_sheet(wb, sheetValuesOnly(src.Sheets[name]), name);
    }
  }
  writeWb(wb, "investor-template.xlsx");
}

// --- BSP template ----------------------------------------------------------
// One row per building; columns keyed by the German header (BSP_COL_MAP).

const BSP: Record<string, [string, string, string]> = {
  "Unternehmen": [COMPANY, COMPANY, COMPANY],
  "Gebäude-Name": ["Musterhausen", "Beispielstadt", "Logistikheim"],
  "Sichtweise": ["Investor", "Investor", "Investor"],
  "Straße": ["Industriestraße 1", "Am Gewerbepark 12", "Lagerweg 5"],
  "PLZ": ["10115", "80331", "20095"],
  "Ort": ["Berlin", "München", "Hamburg"],
  "Bundesland": ["Berlin", "Bayern", "Hamburg"],
  "Anzahl Mieter": ["Single", "Single", "Multi-Tenant"],
  "Mietvertragsart": ["Double-Net", "Double-Net", "Double-Net"],
  "Anteil GreenLeases": ["0", "1", "0.5"],
  "Hauptindustrie des Mieters / Nutzers (Branche)": [
    "Sonstiges",
    "Elektronik",
    "Lebensmittel und Getränke / Frischelogistik",
  ],
  "Funktion der Logistikimmobilie": [
    "Umschlagimmobilie",
    "Lagerimmobilien",
    "Distributionsimmobilien",
  ],
  "Innenraumtemperatur": ["größer 18 Grad", "größer 18 Grad", "kleiner 18 Grad"],
  "Baujahr": ["2015", "2019", "2008"],
  "Klimatisierungstyp": ["Teilklimatisierung", "Nicht klimatisiert", "Nicht klimatisiert"],
  "Ladetore": ["40", "28", "52"],
  "Grundstücksfläche": ["45000", "32000", "51000"],
  "Brutto-Grundfläche (BGF)": ["21200", "15350", "25300"],
  "Zertifizierung vorhanden?": ["Ja", "Ja", "Nein"],
  "Neubauzertifizierung": ["Ja", "Ja", "Nein"],
  "Bestandszertifizierungen": ["Nein", "Nein", "Nein"],
  "DGNB": ["Ja", "Ja", "Nein"],
  "DGNB Zertifizierungsstufe": ["Gold (ab 65%)", "Silber (ab 50%)", ""],
  "PV-Anlage installiert": ["Ja", "Nein", "Ja"],
  "Alter der PV-Anlage (Baujahr)": ["2016", "", "2010"],
  "Leistung der PV-Anlage (kW)": ["750", "", "1200"],
  "Strom - tatsächlicher Verbrauch (kWh)": ["505000", "399000", "700000"],
  "Wärme - tatsächlicher Verbrauch (kWh)": ["300000", "250000", "180000"],
  "Trinkwasser (m³)": ["910", "705", "1205"],
  "Schmutzwasser (m³)": ["910", "705", "1205"],
};

function genBsp(): void {
  const src = readWb(`${DIR}/bsp-template.xlsx`);
  const ws = src.Sheets[src.SheetNames[0]];
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const header: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) header.push(cell(ws, 0, c));

  const aoa: string[][] = [header];
  for (let i = 0; i < 3; i++) {
    aoa.push(header.map((h) => BSP[h]?.[i] ?? ""));
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Energiedaten");
  writeWb(wb, "bsp-template.xlsx");
}

// --- user Lastgang template ------------------------------------------------
// Customer header block (label/value pairs) + a one-day 15-minute load profile.
// parseLastgangXlsx reads col A = end-of-interval timestamp, col B = avg kW.

function genLastgang(): void {
  const header: [string, string][] = [
    ["Kundenname", COMPANY],
    ["Kundennummer", "10000001"],
    ["Marktlokation Name", "Beispiel Logistik Lager 1"],
    ["Marktlokation", "50000000001"],
    ["Metering-Code", "ZP-BEISPIEL-0000-0000-0000-000000"],
    ["Obis-Code", ""],
    ["Zeitzone", "Europe/Berlin"],
    ["Datenaustauschnummer", "Entnahme"],
    ["Energiemenge", "12000.000"],
    ["Nutzungsstunden", "2400.000"],
    ["Höchste Leistung", "180.000"],
    ["Niedrigste Leistung", "0"],
    ["Einheit", "kW"],
  ];

  const aoa: (string | number)[][] = header.map(([a, b]) => [a, b]);

  // One day of 15-min readings (96 intervals). End-of-interval timestamps in
  // Europe/Berlin wall-clock, simple synthetic daily load curve.
  const base = Date.UTC(2024, 5, 1, 0, 0); // 2024-06-01 00:00
  const pad = (n: number) => String(n).padStart(2, "0");
  for (let i = 1; i <= 96; i++) {
    const d = new Date(base + i * 15 * 60 * 1000);
    const ts = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
      `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
    const hour = Math.floor(((i - 1) * 15) / 60);
    // base night load + daytime ramp (06:00–20:00)
    const day = hour >= 6 && hour < 20 ? 120 + 50 * Math.sin(((hour - 6) / 14) * Math.PI) : 35;
    const kw = Math.round(day * 1000) / 1000;
    aoa.push([ts, kw]);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Lastgang");
  writeWb(wb, "user-lastgang-template.xlsx");
}

genInvestor();
genBsp();
genLastgang();
console.log("done.");

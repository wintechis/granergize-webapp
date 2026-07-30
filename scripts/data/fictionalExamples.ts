/**
 * The previous fictional example set (the 4 demo buildings the app seeded
 * before the L.Immo extract took over), reshaped as CONTENT for the bundled
 * investor-layout example workbook (`public/examples/beispiel-portfolio.xlsx`,
 * written by `scripts/genExampleFiles.ts`).
 *
 * The investor row-label sheet carries only what its template rows can express
 * (`INVESTOR_ROW_MAP` + per-year energy + operating costs + certification
 * yes/no+level), so relative to the old hard-coded seed specs this data
 * deliberately DROPS: `customer`/`investor`/`usedAs`/`naceCode`/`buildingArea`/
 * `officeArea`, PV capacity + commissioning year (only the "PV-Anlage
 * installiert" yes/no survives), boiler nameplates, certification scope, the
 * `_inv_gen_*` generation figures, the planned (Soll) dataset and the 15-minute
 * series (the series lives in the separate Lastgang example file). It also has
 * NO coordinates — importing this file demonstrates geocode-on-import (all four
 * are real, geocodable Nürnberg addresses).
 *
 * Values are the SHEET-facing strings (German vocab labels, "Ja" booleans) —
 * exactly what a partner's investor sheet would say; the import normalizes them
 * to the stored tokens (`2-Schicht` → `TwoShift`, …).
 */

/** One column of the investor example sheet: field → sheet value, plus the
 * per-year `_inv_*` energy figures. */
export interface FictionalSpec {
  fields: Record<string, string>;
  annual?: Record<string, string>;
}

export const FICTIONAL_EXAMPLES: readonly FictionalSpec[] = [
  {
    // The fully-populated investor building (annual aggregates, certification,
    // operating costs) — the shape an investor org actually produces.
    fields: {
      buildingCode: "NOP-84",
      streetAddress: "Nordostpark 84",
      postalCode: "90411",
      locality: "Nürnberg",
      region: "Bayern",
      yearOfConstruction: "2016",
      yearOfRenovation: "2021",
      landArea: "20000",
      hallArea: "10200",
      officeSocialArea: "1500",
      buildingHeight: "11.5",
      numberOfLoadingDocks: "14",
      shiftRegime: "2-Schicht",
      tenancyType: "Mehrere Mieter",
      leaseType: "Triple net",
      indoorTemperatureClass: "≤18 °C",
      tenantIndustry: "Contract logistics",
      _pv_present: "Ja",
      _gasboiler_present: "Ja",
      _heatpump_present: "Ja",
      _cert_0_type: "DGNB",
      _cert_0_level: "Gold",
      _opcost_propertyManagement: "Medium",
      _opcost_security: "High",
    },
    annual: {
      _inv_elec_2022: "118000",
      _inv_elec_2023: "121500",
      _inv_elec_2024: "115200",
      _inv_heat_2022: "240000",
      _inv_heat_2023: "232000",
      _inv_heat_2024: "228500",
      _inv_water_2022: "1450",
      _inv_water_2023: "1500",
      _inv_water_2024: "1410",
    },
  },
  {
    // The cold store — electricity-heavy, low heat.
    fields: {
      buildingCode: "HAF-12",
      streetAddress: "Hafenstraße 12",
      postalCode: "90451",
      locality: "Nürnberg",
      region: "Bayern",
      yearOfConstruction: "2018",
      landArea: "12000",
      hallArea: "6800",
      officeSocialArea: "550",
      buildingHeight: "12",
      numberOfLoadingDocks: "6",
      shiftRegime: "3-Schicht",
      tenancyType: "Einzelmieter",
      leaseType: "Triple net",
      indoorTemperatureClass: "≤12 °C",
      tenantIndustry: "Food logistics",
      _pv_present: "Ja",
      _heatpump_present: "Ja",
      _cert_0_type: "LEED",
      _cert_0_level: "Silver",
      _opcost_propertyManagement: "Medium",
    },
    annual: {
      _inv_elec_2022: "210000",
      _inv_elec_2023: "205000",
      _inv_elec_2024: "198000",
      _inv_heat_2022: "60000",
      _inv_heat_2023: "58000",
      _inv_heat_2024: "55000",
      _inv_water_2022: "640",
      _inv_water_2023: "660",
      _inv_water_2024: "650",
    },
  },
  {
    // The small office — the light, end-user shape (two annual years).
    fields: {
      buildingCode: "LG-20",
      streetAddress: "Lange Gasse 20",
      postalCode: "90403",
      locality: "Nürnberg",
      region: "Bayern",
      yearOfConstruction: "1998",
    },
    annual: {
      _inv_elec_2023: "48200",
      _inv_elec_2024: "46900",
      _inv_heat_2023: "142000",
      _inv_heat_2024: "138500",
      _inv_water_2023: "260",
      _inv_water_2024: "255",
    },
  },
  {
    // The small workshop — master data only (energy gets added in the app).
    fields: {
      buildingCode: "PIR-68",
      streetAddress: "Pirckheimerstraße 68",
      postalCode: "90408",
      locality: "Nürnberg",
      region: "Bayern",
      yearOfConstruction: "2005",
      _pv_present: "Ja",
    },
  },
] as const;

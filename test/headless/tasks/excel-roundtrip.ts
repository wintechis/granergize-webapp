/// <reference lib="deno.ns" />
/**
 * Catalog task `excel-roundtrip` (headless): the data-layer half of the
 * excel-export e2e — a building (incl. an annual energy dataset) written to a
 * real Pod, read back through the full fetch+parse orchestration, exported to
 * a styled XLSX workbook, re-imported from those bytes, written again as a new
 * building, and read back equal. Bisects an excel-export e2e failure: this
 * green + the browser spec red points at the UI (download/file-picker/dialog),
 * both red points at the data layer or server interop.
 */
import { type TaskContext } from "../taskContext.ts";
import {
  attachAnnualData,
  deleteBuilding,
  newBuildingUri,
  serializeBuildingToTurtle,
  uploadBuilding,
  writeBuildingEnergy,
} from "../../../src/services/rdf/building/buildingSerializer.ts";
import {
  detectSpreadsheetFormat,
  parseCsvToFields,
} from "../../../src/services/rdf/building/buildingImport.ts";
import { buildingsToXlsx } from "../../../src/services/rdf/buildingWorkbook.ts";
import { fetchAndParseData } from "../../../src/services/TurtleParsingService.ts";

import {
  mintBuildingSubject,
} from "../../../src/services/rdf/building/buildingId.ts";

export const name = "excel-roundtrip";

export async function run(ctx: TaskContext): Promise<void> {
  const { a, check } = ctx;
  const id1 = `xr-${Date.now()}`;
  const id2 = `${id1}-reimport`;
  const uri1 = newBuildingUri(a.webId, id1);
  const uri2 = newBuildingUri(a.webId, id2);

  const fields: Record<string, string> = {
    label: "Roundtrip Lager",
    buildingCode: "XR-001",
    streetAddress: "Exportstraße 5",
    postalCode: "90402",
    locality: "Nürnberg",
    region: "Bayern",
    lat: "49.45",
    long: "11.08",
    _inv_elec_2024: "12345",
    _inv_water_2024: "67",
  };

  try {
    // Write the original: annual dataset resource first, then the building
    // file linking it (the Add-dialog import order).
    const links1 = await writeBuildingEnergy(
      a.session,
      uri1,
      mintBuildingSubject(uri1),
      fields,
    );
    check("annual dataset written and linked", links1.length === 1);
    await uploadBuilding(
      a.session,
      uri1,
      serializeBuildingToTurtle(fields, uri1, links1),
      a.webId,
    );

    // Read back through the full orchestration and export.
    const data1 = await fetchAndParseData(a.session);
    const orig = data1.buildings.find((x) => x.sourceUri === uri1);
    check("fetchAndParseData discovers the building", Boolean(orig));
    if (!orig) return;
    const [enriched] = await attachAnnualData([orig], a.session);
    check(
      "attachAnnualData loads the 2024 figures",
      enriched.annualData?.[0]?.year === 2024 &&
        enriched.annualData?.[0]?.electricityConsumption === 12345,
      JSON.stringify(enriched.annualData),
    );
    const bytes = await buildingsToXlsx([enriched]);
    check("export produced workbook bytes", bytes.byteLength > 0);

    // The exported workbook auto-detects as generic and re-parses to the same
    // field map (the styled header/zebra/logo must be invisible to the parser).
    const file = new File([bytes], "buildings-mine.xlsx");
    check(
      "exported workbook auto-detects as generic",
      (await detectSpreadsheetFormat(file)) === "generic",
    );
    const rows = await parseCsvToFields(file, "generic");
    check("one building re-parsed from the export", rows.length === 1);
    const row = rows[0] ?? {};
    check(
      "address survives the round-trip",
      row.streetAddress === "Exportstraße 5",
      row.streetAddress,
    );
    check(
      "annual energy survives the round-trip",
      row._inv_elec_2024 === "12345" && row._inv_water_2024 === "67",
      `${row._inv_elec_2024}/${row._inv_water_2024}`,
    );

    // Delete the original (codes must stay unique), re-import the parsed row
    // as a new building, and read it back equal.
    await deleteBuilding(a.session, a.webId, uri1);
    const links2 = await writeBuildingEnergy(
      a.session,
      uri2,
      mintBuildingSubject(uri2),
      row,
    );
    await uploadBuilding(
      a.session,
      uri2,
      serializeBuildingToTurtle(row, uri2, links2),
      a.webId,
    );

    const data2 = await fetchAndParseData(a.session);
    check(
      "original is gone after delete",
      !data2.buildings.some((x) => x.sourceUri === uri1),
    );
    const reimported = data2.buildings.find((x) => x.sourceUri === uri2);
    check("re-imported building is discovered", Boolean(reimported));
    if (!reimported) return;
    check(
      "re-imported address matches the original",
      reimported.streetAddress === "Exportstraße 5",
      reimported.streetAddress,
    );
    const [enriched2] = await attachAnnualData([reimported], a.session);
    check(
      "re-imported annual energy matches the original",
      enriched2.annualData?.[0]?.year === 2024 &&
        enriched2.annualData?.[0]?.electricityConsumption === 12345 &&
        enriched2.annualData?.[0]?.waterConsumption === 67,
      JSON.stringify(enriched2.annualData),
    );
  } finally {
    await Promise.allSettled([
      deleteBuilding(a.session, a.webId, uri1),
      deleteBuilding(a.session, a.webId, uri2),
    ]);
  }
}

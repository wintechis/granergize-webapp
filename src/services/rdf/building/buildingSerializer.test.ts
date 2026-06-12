/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { DataFactory, Parser, Store } from "n3";
import * as XLSX from "xlsx";
import type { BuildingType } from "../../../types.ts";
import {
  annualDatasetsFromFields,
  deleteBuilding,
  deleteEnergyYear,
  newBuildingUri,
  parseCsvToFields,
  seedDemoBuildings,
  serializeBuildingToTurtle,
  uploadBuilding,
  writeBuildingEnergy,
  writeEnergyYear,
} from "./buildingSerializer.ts";
import { buildingsToXlsx, buildingToXlsx } from "../buildingWorkbook.ts";
import { synthDayReadings } from "../energySeriesXlsx.ts";
import {
  datasetFileUrl,
  datasetNodeUrl,
} from "../energyDataset.ts";
import { toggleBuildingVisibility } from "../../interop/sharingManager.ts";
import { parseBuildings } from "./buildingParser.ts";
import { _setStorageRootForTesting, podResources } from "../../pod/solidUtils.ts";
import { makeFakeSession } from "../../testing/fakeSession.ts";
import {
  GEO_LAT,
  GEO_LOCATION,
  GEO_LONG,
  GEO_POINT,
  GEOCODE_PRECISION_IRI,
  GRAN_GEOCODE_PRECISION,
  BUILDING_NS,
  CONSUMPTION_NS,
  GRAN_NS,
  PROV_NS,
  RDF_TYPE,
  REC_NS,
  REC_OWNED_BY,
  XSD_INTEGER,
} from "../vocabularies.ts";

const { namedNode } = DataFactory;

// Offline data-layer tests: a fake Session serves/records Turtle by URL so the
// create / register / hide paths run with no network or Pod. WebID resolves to
// storageRoot = https://pod.example/ ; all app paths hang off granergize/.
const WEBID = "https://pod.example/profile/card#me";
_setStorageRootForTesting(WEBID, "https://pod.example/");

const PREFS_URL = podResources(WEBID).prefs;
const REC_BUILDING = "https://w3id.org/rec#Building";

/** Parse a Turtle string into an n3 Store (absolute IRIs, default graph). */
function parse(ttl: string): Store {
  return new Store(new Parser().parse(ttl));
}

/**
 * A stateful fake Session: GET reads the in-memory store, PUT/POST writes back to
 * it (so read-append-write flows accumulate). Records every call for assertions.
 * The registry's `?t=` cache-buster is stripped.
 */
const makeSession = (initial: Record<string, string> = {}) =>
  makeFakeSession({ webId: WEBID, resources: initial });

// ── serialize (the create path) ────────────────────────────────────────────────

Deno.test("serializeBuildingToTurtle types the subject as rec:Building (capital B)", () => {
  const uri = newBuildingUri(WEBID, "b-1");
  const store = parse(serializeBuildingToTurtle({ streetAddress: "X" }, uri));
  const types = store.getQuads(null, namedNode(RDF_TYPE), null, null);
  assert.ok(
    types.some((q) => q.object.value === REC_BUILDING),
    "expected rec:Building (capital)",
  );
  assert.ok(
    !types.some((q) => q.object.value === "https://w3id.org/rec#building"),
    "must not emit the lowercase rec:building",
  );
});

Deno.test("serializeBuildingToTurtle round-trips core fields through the parser", () => {
  const uri = newBuildingUri(WEBID, "b-1");
  const ttl = serializeBuildingToTurtle(
    { streetAddress: "Nordostpark 84", locality: "Nürnberg", lat: "49.4", long: "11.1" },
    uri,
  );
  const b = parseBuildings(new Parser().parse(ttl)).get(`${uri}#it`);
  assert.ok(b, "building parsed back");
  assert.equal(b!.streetAddress, "Nordostpark 84");
  assert.equal(b!.locality, "Nürnberg");
  assert.equal(b!.lat, 49.4);
  assert.equal(b!.long, 11.1);
});

Deno.test("serializeBuildingToTurtle writes operatedBy as a rec:operatedBy IRI reference (NamedNode, not a literal)", () => {
  const uri = newBuildingUri(WEBID, "b-op");
  const operator = "https://operator.example/profile/card#me";
  const ttl = serializeBuildingToTurtle({ operatedBy: operator }, uri);
  const store = parse(ttl);
  const quads = store.getQuads(
    namedNode(`${uri}#it`),
    namedNode(`${REC_NS}operatedBy`),
    null,
    null,
  );
  assert.equal(quads.length, 1, "one operatedBy triple");
  assert.equal(quads[0].object.termType, "NamedNode", "operator is an IRI, not a literal");
  assert.equal(quads[0].object.value, operator);

  // And it round-trips back through the parser as the WebID string.
  const b = parseBuildings(new Parser().parse(ttl)).get(`${uri}#it`);
  assert.equal(b!.operatedBy, operator);
});

Deno.test("parseBuildings tolerates a legacy xsd:string operatedBy literal", () => {
  const uri = newBuildingUri(WEBID, "b-legacy");
  // Old Pods stored operatedBy as a plain string literal.
  const ttl = `
    @prefix rec: <${REC_NS}> .
    <${uri}#b-legacy> a <https://w3id.org/rec#Building> ;
      rec:operatedBy "Acme Facility GmbH" .`;
  const b = parseBuildings(new Parser().parse(ttl)).get(`${uri}#b-legacy`);
  assert.equal(b!.operatedBy, "Acme Facility GmbH");
});

Deno.test("serializeBuildingToTurtle writes investor + ownedBy as IRI references (agent links like operatedBy)", () => {
  const uri = newBuildingUri(WEBID, "b-agents");
  const investor = "https://investor.example/profile/card#me";
  const owner = "https://owner.example/profile/card#me";
  const ttl = serializeBuildingToTurtle({ investor, ownedBy: owner }, uri);
  const store = parse(ttl);

  for (
    const [pred, iri, value] of [
      ["investor", `${BUILDING_NS}investor`, investor],
      ["ownedBy", REC_OWNED_BY, owner],
    ]
  ) {
    const quads = store.getQuads(
      namedNode(`${uri}#it`),
      namedNode(iri),
      null,
      null,
    );
    assert.equal(quads.length, 1, `one ${pred} triple`);
    assert.equal(
      quads[0].object.termType,
      "NamedNode",
      `${pred} is an IRI, not a literal`,
    );
    assert.equal(quads[0].object.value, value);
  }

  // And they round-trip back through the parser as the WebID strings.
  const b = parseBuildings(new Parser().parse(ttl)).get(`${uri}#it`);
  assert.equal(b!.investor, investor);
  assert.equal(b!.ownedBy, owner);
});

Deno.test("serializeBuildingToTurtle writes facilityManagedBy/developedBy/consultedBy as IRI references", () => {
  const uri = newBuildingUri(WEBID, "b-agents2");
  const fm = "https://fm.example/profile/card#me";
  const dev = "https://developer.example/profile/card#me";
  const consultant = "https://broker.example/profile/card#me";
  const ttl = serializeBuildingToTurtle(
    { facilityManagedBy: fm, developedBy: dev, consultedBy: consultant },
    uri,
  );
  const store = parse(ttl);

  for (
    const [pred, value] of [
      ["facilityManagedBy", fm],
      ["developedBy", dev],
      ["consultedBy", consultant],
    ]
  ) {
    const quads = store.getQuads(
      namedNode(`${uri}#it`),
      namedNode(`${BUILDING_NS}${pred}`),
      null,
      null,
    );
    assert.equal(quads.length, 1, `one ${pred} triple`);
    assert.equal(
      quads[0].object.termType,
      "NamedNode",
      `${pred} is an IRI, not a literal`,
    );
    assert.equal(quads[0].object.value, value);
  }

  // And they round-trip back through the parser as the WebID strings.
  const b = parseBuildings(new Parser().parse(ttl)).get(`${uri}#it`);
  assert.equal(b!.facilityManagedBy, fm);
  assert.equal(b!.developedBy, dev);
  assert.equal(b!.consultedBy, consultant);
});

Deno.test("parseBuildings tolerates a legacy xsd:string investor literal", () => {
  const uri = newBuildingUri(WEBID, "b-inv-legacy");
  // Old Pods (and the partner import templates) stored investor as a plain string.
  const ttl = `
    @prefix bldg: <${BUILDING_NS}> .
    <${uri}#b-inv-legacy> a <https://w3id.org/rec#Building> ;
      bldg:investor "Aurelis" .`;
  const b = parseBuildings(new Parser().parse(ttl)).get(`${uri}#b-inv-legacy`);
  assert.equal(b!.investor, "Aurelis");
});

Deno.test("serializeBuildingToTurtle still types numeric literals with their XSD datatype", () => {
  const uri = newBuildingUri(WEBID, "b-dt");
  const ttl = serializeBuildingToTurtle({ buildingArea: "1200" }, uri);
  const obj = parse(ttl).getQuads(
    namedNode(`${uri}#it`),
    namedNode(`${BUILDING_NS}hasBuildingArea`),
    null,
    null,
  )[0].object;
  assert.equal(obj.termType, "Literal");
  assert.equal((obj as { datatype: { value: string } }).datatype.value, XSD_INTEGER);
});

Deno.test("serializeBuildingToTurtle writes coordinates as a geo:Point blank node with precision (not flat)", () => {
  const uri = newBuildingUri(WEBID, "b-geo");
  const ttl = serializeBuildingToTurtle(
    {
      streetAddress: "Auchterstraße 9",
      locality: "Reutlingen",
      lat: "48.46",
      long: "9.15",
      geocodePrecision: "postcode",
    },
    uri,
  );
  const quads = new Parser().parse(ttl);
  const store = new Store(quads);
  const subject = namedNode(`${uri}#it`);

  // No flat coordinates on the building subject.
  assert.equal(
    store.getQuads(subject, namedNode(GEO_LAT), null, null).length,
    0,
    "no flat geo:lat on the building",
  );
  assert.equal(
    store.getQuads(subject, namedNode(GEO_LONG), null, null).length,
    0,
    "no flat geo:long on the building",
  );

  // A geo:location → geo:Point blank node carrying lat/long + precision.
  const link = store.getQuads(subject, namedNode(GEO_LOCATION), null, null);
  assert.equal(link.length, 1, "one geo:location link");
  const point = link[0].object;
  assert.equal(point.termType, "BlankNode");
  assert.equal(
    store.getQuads(point, namedNode(RDF_TYPE), namedNode(GEO_POINT), null).length,
    1,
    "point is typed geo:Point",
  );
  assert.equal(store.getObjects(point, namedNode(GEO_LAT), null)[0]?.value, "48.46");
  assert.equal(store.getObjects(point, namedNode(GEO_LONG), null)[0]?.value, "9.15");
  assert.equal(
    store.getObjects(point, namedNode(GRAN_GEOCODE_PRECISION), null)[0]?.value,
    GEOCODE_PRECISION_IRI.postcode,
  );

  // Round-trips through the parser back to flat BuildingType fields.
  const b = parseBuildings(quads).get(`${uri}#it`);
  assert.ok(b, "building parsed back");
  assert.equal(b!.lat, 48.46);
  assert.equal(b!.long, 9.15);
  assert.equal(b!.geocodePrecision, "postcode");
});

Deno.test("parseBuildings still reads legacy flat geo:lat/long (no point)", () => {
  const ttl = `
    @prefix rec: <https://w3id.org/rec#> .
    @prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
    <https://pod.example/granergize/buildings/b-legacy.ttl#b-legacy>
      a rec:Building ; geo:lat 49.0 ; geo:long 11.0 .
  `;
  const b = parseBuildings(new Parser().parse(ttl)).get("https://pod.example/granergize/buildings/b-legacy.ttl#b-legacy");
  assert.ok(b, "legacy building parsed");
  assert.equal(b!.lat, 49.0);
  assert.equal(b!.long, 11.0);
  assert.equal(b!.geocodePrecision, undefined);
});

Deno.test("serializeBuildingToTurtle links energy datasets via cons:hasEnergyDataset", () => {
  const uri = newBuildingUri(WEBID, "b-1");
  const base = uri.replace(/\.ttl$/, "");
  const dsA = `${base}/energy/2024-P1Y.ttl#ds`;
  const dsB = `${base}/energy/2024-PT15M.ttl#ds`;
  const ttl = serializeBuildingToTurtle({ streetAddress: "X" }, uri, [dsA, dsB]);

  // Raw shape: one cons:hasEnergyDataset link per dataset (no inline energy).
  const store = parse(ttl);
  const links = store.getQuads(
    null,
    namedNode(`${CONSUMPTION_NS}hasEnergyDataset`),
    null,
    null,
  );
  assert.equal(links.length, 2);

  // Parsed shape: refs surface on building.energyDatasets (the loader dispatches
  // on the granularity in the slug).
  const b = parseBuildings(new Parser().parse(ttl)).get(`${uri}#it`);
  assert.ok(b);
  assert.equal(b!.energyDatasets!.length, 2);
  assert.deepEqual(
    b!.energyDatasets!.map((d) => d.granularity).sort(),
    ["P1Y", "PT15M"],
  );
});

Deno.test("annualDatasetsFromFields converts _inv_*/_bsp_* fields to annual P1Y datasets", () => {
  const subj = `${newBuildingUri(WEBID, "b-1")}#b-1`;
  const ds = annualDatasetsFromFields(subj, {
    _inv_elec_2023: "121500",
    _inv_heat_2023: "232000",
    _bsp_year: "2024",
    _bsp_water: "1500",
  });

  const y2023 = ds.find((d) => d.year === 2023);
  assert.ok(y2023, "investor 2023 dataset");
  assert.equal(y2023!.granularity, "P1Y");
  assert.equal(y2023!.scenario, "actual");
  assert.equal(y2023!.metrics!.electricityConsumption, 121500);
  assert.equal(y2023!.metrics!.heatConsumption, 232000);

  const y2024 = ds.find((d) => d.year === 2024);
  assert.ok(y2024, "benchmark 2024 dataset");
  assert.equal(y2024!.metrics!.waterConsumption, 1500);
});

Deno.test("serializeBuildingToTurtle round-trips investor operating costs", () => {
  const uri = newBuildingUri(WEBID, "b-1");
  const ttl = serializeBuildingToTurtle({
    streetAddress: "X",
    _opcost_wasteDisposal: "Landlord",
    _opcost_security: "All-Risk",
    _opcost_operationInspectionAndMaintenance: "true",
  }, uri);

  // Raw shape: one investor:hasOperatingCosts blank node carries the categories.
  const store = parse(ttl);
  assert.equal(
    store.getQuads(null, namedNode(`${BUILDING_NS}hasOperatingCosts`), null, null)
      .length,
    1,
  );

  // Parsed shape: the values land on building.operatingCosts (boolean coerced).
  const b = parseBuildings(new Parser().parse(ttl)).get(`${uri}#it`);
  assert.ok(b);
  assert.ok(b!.operatingCosts);
  assert.equal(b!.operatingCosts!.wasteDisposal, "Landlord");
  assert.equal(b!.operatingCosts!.security, "All-Risk");
  assert.equal(b!.operatingCosts!.operationInspectionAndMaintenance, true);
});

Deno.test("serializeBuildingToTurtle round-trips multiple building certifications", () => {
  const uri = newBuildingUri(WEBID, "b-1");
  const ttl = serializeBuildingToTurtle({
    streetAddress: "X",
    _cert_0_type: "BREEAM",
    _cert_0_level: "Very Good",
    _cert_0_scope: "WholeBuilding",
    _cert_1_type: "DGNB",
    _cert_1_level: "Gold",
  }, uri);

  const b = parseBuildings(new Parser().parse(ttl)).get(`${uri}#it`);
  assert.ok(b);
  const certs = b!.certifications ?? [];
  assert.equal(certs.length, 2);
  const breeam = certs.find((c) => c.type === "BREEAM");
  assert.ok(breeam, "BREEAM certification present");
  assert.equal(breeam!.level, "Very Good");
  assert.equal(breeam!.scope, "WholeBuilding");
  const dgnb = certs.find((c) => c.type === "DGNB");
  assert.ok(dgnb, "DGNB certification present");
  assert.equal(dgnb!.level, "Gold");
});

Deno.test("serializeBuildingToTurtle rejects an IRI-unsafe certification type (no silent corruption)", () => {
  // The type mints `bldg:<type>Certification`; "DGNB Gold" (a space) would write
  // an invalid IRI that breaks the WHOLE file on its next parse — the building
  // silently vanishes from the listing. The serializer must fail loudly instead.
  const uri = newBuildingUri(WEBID, "b-1");
  assert.throws(
    () =>
      serializeBuildingToTurtle(
        { streetAddress: "X", _cert_0_type: "DGNB Gold" },
        uri,
      ),
    /not usable as an IRI local name/,
  );
});

Deno.test("serializeBuildingToTurtle rejects an IRI-unsafe controlled-vocab value (no silent corruption)", () => {
  // Same failure class as the certification type: a controlled-vocab field's
  // value is minted as a BUILDING_NS local name, so junk reaching it (e.g. an
  // unmapped import label like "Ein-Schicht (Tag)") must throw, not corrupt.
  const uri = newBuildingUri(WEBID, "b-1");
  assert.throws(
    () =>
      serializeBuildingToTurtle(
        { streetAddress: "X", shiftRegime: "Ein-Schicht (Tag)" },
        uri,
      ),
    /not usable as an IRI local name/,
  );
});

Deno.test("postalCode and naceCode round-trip as identifier strings (leading zero, trailing zero kept)", () => {
  // Regression: postalCode as xsd:integer turned "01067" (Dresden) into 1067,
  // and naceCode as xsd:decimal turned "52.10" into 52.1 — a DIFFERENT NACE
  // class. Both are identifiers, not numbers.
  const uri = newBuildingUri(WEBID, "b-1");
  const ttl = serializeBuildingToTurtle(
    { streetAddress: "X", postalCode: "01067", naceCode: "52.10" },
    uri,
  );
  const b = parseBuildings(new Parser().parse(ttl)).get(`${uri}#it`);
  assert.ok(b);
  assert.equal(b!.postalCode, "01067");
  assert.equal(b!.naceCode, "52.10");
});

Deno.test("parseCsvToFields extracts investor operating costs + certification, end-to-end", async () => {
  // Minimal investor sheet using the real template labels: operating costs come
  // from the "Servicelevel" rows, certifications from per-system yes/no + level.
  const rows: (string | number)[][] = [
    ["", "Gebäude-Code", "", "INV-1"],
    ["", "Straße", "", "Teststraße 1"],
    ["", "Entsorgung", "", "Mittel"],
    ["", "Bedienung, Inspektion und Wartung", "", "ja"],
    ["", "BREEAM", "", "Ja"],
    ["", "BREEAM Zertifizierungsstufe", "", "Very Good"],
    ["", "DGNB", "", "Nein"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const file = new File([buf], "investor.xlsx");

  const parsed = await parseCsvToFields(file, "investor");
  assert.equal(parsed.length, 1);
  const f = parsed[0];
  assert.equal(f._opcost_wasteDisposal, "Mittel");
  assert.equal(f._opcost_operationInspectionAndMaintenance, "true");
  assert.equal(f._cert_0_type, "BREEAM");
  assert.equal(f._cert_0_level, "Very Good");
  // DGNB row is "Nein" → no second certification.
  assert.equal(f._cert_1_type, undefined);

  // Full Excel → serialize → parse chain materialises them on the building.
  const uri = newBuildingUri(WEBID, "inv-1");
  const b = parseBuildings(new Parser().parse(serializeBuildingToTurtle(f, uri)))
    .get(`${uri}#it`);
  assert.ok(b);
  assert.equal(b!.operatingCosts!.wasteDisposal, "Mittel");
  assert.equal(b!.operatingCosts!.operationInspectionAndMaintenance, true);
  assert.equal(b!.certifications!.length, 1);
  assert.equal(b!.certifications![0].type, "BREEAM");
  assert.equal(b!.certifications![0].level, "Very Good");
});

Deno.test("buildingToXlsx → investor Excel re-imports and round-trips the building", async () => {
  const building = {
    id: "b-1",
    uri: "https://pod.example/granergize/buildings/b-1.ttl#b-1",
    buildingCode: "B-1",
    streetAddress: "Nordostpark 84",
    yearOfConstruction: 1998,
    shiftRegime: "1-Shift", // stored as a label; normalises back on import
    annualData: [
      { year: 2023, electricityConsumption: 121500, heatConsumption: 232000 },
    ],
    operatingCosts: {
      wasteDisposal: "Landlord",
      operationInspectionAndMaintenance: true,
    },
    certifications: [{ type: "BREEAM", level: "Very Good", scope: "WholeBuilding" }],
  } as unknown as BuildingType;

  // Export → bytes → re-import via the investor (row-label) path.
  const file = new File([await buildingToXlsx(building, "investor")], "b-1.xlsx");
  const parsed = await parseCsvToFields(file, "investor");
  assert.equal(parsed.length, 1);
  const f = parsed[0];
  assert.equal(f.streetAddress, "Nordostpark 84");
  assert.equal(f.yearOfConstruction, "1998");
  assert.equal(f.shiftRegime, "OneShift");
  assert.equal(f._inv_elec_2023, "121500");
  assert.equal(f._opcost_wasteDisposal, "Landlord");
  assert.equal(f._opcost_operationInspectionAndMaintenance, "true");
  assert.equal(f._cert_0_type, "BREEAM");

  // …and serialize → parse reproduces the building's modelled data.
  const uri = newBuildingUri(WEBID, "b-1");
  const rt = parseBuildings(new Parser().parse(serializeBuildingToTurtle(f, uri)))
    .get(`${uri}#it`);
  assert.ok(rt);
  assert.equal(rt!.streetAddress, "Nordostpark 84");
  assert.equal(rt!.shiftRegime, "1-Shift");
  assert.equal(rt!.operatingCosts!.wasteDisposal, "Landlord");
  assert.equal(rt!.certifications![0].type, "BREEAM");
  // Energy now lives in separate dataset resources; the imported fields convert
  // to the right annual dataset.
  assert.equal(
    annualDatasetsFromFields(`${uri}#b-1`, f).find((d) => d.year === 2023)!
      .metrics!.electricityConsumption,
    121500,
  );
});

Deno.test("buildingsToXlsx is one sheet, one row per building, round-tripping via generic import", async () => {
  const buildings = [
    {
      id: "1",
      streetAddress: "A-Straße 1",
      yearOfConstruction: 1990,
      annualData: [{ year: 2023, electricityConsumption: 1000 }],
      operatingCosts: { wasteDisposal: "Landlord" },
      certifications: [{ type: "BREEAM", level: "Very Good" }],
    },
    {
      id: "2",
      streetAddress: "B-Weg 2",
      annualData: [{
        year: 2024,
        electricityConsumption: 2000,
        wastewaterConsumption: 50,
      }],
    },
  ] as unknown as BuildingType[];

  // One sheet, two data rows (one per building).
  const wb = XLSX.read(new Uint8Array(await buildingsToXlsx(buildings)), {
    type: "array",
  });
  assert.deepEqual(wb.SheetNames, ["Gebäude"]);
  const sheetRows = XLSX.utils.sheet_to_json<Record<string, string>>(
    wb.Sheets["Gebäude"],
    { raw: false, defval: "" },
  );
  assert.equal(sheetRows.length, 2);
  assert.equal(sheetRows[0].streetAddress, "A-Straße 1");
  assert.equal(sheetRows[1].streetAddress, "B-Weg 2");

  // The unified sheet re-imports (generic path) and serialize→parse reproduces
  // each building's master data, energy, operating costs and certification.
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const parsed = await parseCsvToFields(new File([buf], "all.xlsx"), "generic");
  assert.equal(parsed.length, 2);

  const rt = (f: Record<string, string>, fileName: string) =>
    parseBuildings(new Parser().parse(
      serializeBuildingToTurtle(f, newBuildingUri(WEBID, fileName)),
    )).get(`${newBuildingUri(WEBID, fileName)}#it`);

  const b1 = rt(parsed[0], "b-1");
  assert.ok(b1);
  assert.equal(b1!.streetAddress, "A-Straße 1");
  assert.equal(b1!.operatingCosts!.wasteDisposal, "Landlord");
  assert.equal(b1!.certifications![0].type, "BREEAM");
  assert.equal(
    annualDatasetsFromFields("b-1#b-1", parsed[0]).find((d) => d.year === 2023)!
      .metrics!.electricityConsumption,
    1000,
  );

  const b2 = rt(parsed[1], "b-2");
  assert.ok(b2);
  assert.equal(b2!.streetAddress, "B-Weg 2");
  assert.equal(
    annualDatasetsFromFields("b-2#b-2", parsed[1]).find((d) => d.year === 2024)!
      .metrics!.wastewaterConsumption,
    50,
  );
});

Deno.test("serializeBuildingToTurtle records the producing agent only (no role)", () => {
  const uri = newBuildingUri(WEBID, "b-1");
  const agent = "https://pod.example/profile/card#me";
  const ttl = serializeBuildingToTurtle({ streetAddress: "X" }, uri, undefined, {
    agent,
  });

  // Raw shape: a prov:qualifiedAttribution blank node with agent and NO hadRole
  // (a building no longer records a producing-role category).
  const store = parse(ttl);
  assert.equal(
    store.getQuads(
      null,
      namedNode(`${PROV_NS}qualifiedAttribution`),
      null,
      null,
    ).length,
    1,
  );
  assert.equal(
    store.getQuads(null, namedNode(`${PROV_NS}hadRole`), null, null).length,
    0,
  );

  // Parsed shape: only attributedTo (the agent) lands on the building.
  const b = parseBuildings(new Parser().parse(ttl)).get(`${uri}#it`);
  assert.ok(b);
  assert.equal(b!.attributedTo, agent);
});

// ── upload + registry (write to the Pod) ────────────────────────────────────────

Deno.test("uploadBuilding PUTs the Turtle to the building URI", async () => {
  const { session, calls, store } = makeSession();
  const uri = newBuildingUri(WEBID, "b-1");
  const ttl = serializeBuildingToTurtle({ streetAddress: "X" }, uri);

  await uploadBuilding(session, uri, ttl, WEBID);

  const put = calls.find((c) => c.method === "PUT" && c.url === uri);
  assert.ok(put, "building was PUT to its URI");
  assert.equal(put!.body, ttl);
  assert.equal(store[uri], ttl);
});

Deno.test("writeBuildingEnergy stops writing daily files once aborted", async () => {
  const { session, calls } = makeSession();
  const controller = new AbortController();
  // Abort the moment the first 15-min daily file is dispatched, so the rest of
  // the year's files can't be written.
  const inner = session.fetch.bind(session);
  (session as { fetch: typeof fetch }).fetch = ((
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    const p = inner(input as string, init);
    if (
      (init?.method ?? "GET").toUpperCase() === "PUT" &&
      url.includes("PT15M") && url.endsWith(".ttl")
    ) {
      controller.abort();
    }
    return p;
  }) as typeof fetch;

  const uri = newBuildingUri(WEBID, "b-cancel");
  const subject = `${uri}#it`;
  const days = Array.from({ length: 12 }, (_, i) => {
    const date = `2099-01-${String(i + 1).padStart(2, "0")}`;
    return { date, readings: synthDayReadings(date) };
  });

  await assert.rejects(() =>
    writeBuildingEnergy(
      session,
      uri,
      subject,
      {},
      { year: 2099, days, label: "x" },
      undefined,
      controller.signal,
    )
  );

  const dailyPuts = calls.filter((c) =>
    c.method === "PUT" && c.url.includes("PT15M") && c.url.endsWith(".ttl")
  );
  assert.ok(dailyPuts.length >= 1, "at least one daily file was written");
  assert.ok(
    dailyPuts.length < days.length,
    "the abort stopped the remaining daily files",
  );
});

// ── hide / unhide (the "delete" path) ───────────────────────────────────────────

Deno.test("toggleBuildingVisibility hides a visible building", async () => {
  const { session, store } = makeSession(); // no prefs file yet → 404
  const buildingUri = "https://other.example/granergize/buildings/x.ttl#x";

  await toggleBuildingVisibility(buildingUri, session);

  const hidden = parse(store[PREFS_URL]);
  assert.equal(
    hidden.getQuads(
      namedNode(PREFS_URL),
      namedNode(`${GRAN_NS}hiddenBuilding`),
      namedNode(buildingUri),
      null,
    ).length,
    1,
    "building is now marked hidden",
  );
});

Deno.test("toggleBuildingVisibility unhides an already-hidden building", async () => {
  const buildingUri = "https://other.example/granergize/buildings/x.ttl#x";
  const existing =
    `@prefix gran: <${GRAN_NS}> .\n<${PREFS_URL}> gran:hiddenBuilding <${buildingUri}> .\n`;
  const { session, store } = makeSession({ [PREFS_URL]: existing });

  await toggleBuildingVisibility(buildingUri, session);

  const hidden = parse(store[PREFS_URL]);
  assert.equal(
    hidden.getQuads(null, namedNode(`${GRAN_NS}hiddenBuilding`), null, null).length,
    0,
    "the hidden mark was removed",
  );
});

// ── synthetic readings + full demo seed ─────────────────────────────────────────

Deno.test("synthDayReadings yields a full UTC day of 15-minute slots", () => {
  const r = synthDayReadings("2024-06-03");
  assert.equal(r.length, 96);
  assert.equal(r[0].beginTs, "2024-06-03T00:00:00Z");
  assert.equal(r[0].slotId, "0000");
  assert.equal(r[1].beginTs, "2024-06-03T00:15:00Z");
  assert.equal(r[95].endTs, "2024-06-04T00:00:00Z");
  // values are non-negative kWh-per-slot strings
  assert.ok(r.every((x) => parseFloat(x.valueKwh) >= 0));
});

Deno.test("seedDemoBuildings seeds two buildings with different granularities", async () => {
  const { session, calls } = makeSession();

  // Stub the geocoder (global fetch) so the seed runs offline.
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("nominatim")) {
      return Promise.resolve(
        new Response(JSON.stringify([{ lat: "49.45", lon: "11.08" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("nope", { status: 404 }));
  }) as typeof fetch;

  let tally: { seeded: number; total: number };
  try {
    // The demo set spans both energy shapes (annual P1Y + 15-minute series).
    tally = await seedDemoBuildings(session, WEBID);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(tally, { seeded: 4, total: 4 }, "full seed reports 4/4");

  // Two building files written (under granergize/buildings/, not the energy files).
  const buildingPuts = calls.filter((c) =>
    c.method === "PUT" &&
    /\/granergize\/buildings\/[^/]+\.ttl$/.test(c.url)
  );
  // 2 investor + 2 user demo buildings.
  assert.equal(buildingPuts.length, 4, "four demo buildings uploaded");

  // Daily 15-minute reading files, inside a series container (one file per series
  // day; the two user demos carry multi-day series).
  const energyPuts = calls.filter((c) =>
    c.method === "PUT" && /\/2024-PT15M\/\d{4}-\d{2}-\d{2}\.ttl$/.test(c.url)
  );
  assert.ok(energyPuts.length >= 1, "15-min daily reading files uploaded");

  // Energy is NOT inline: each building links its datasets via cons:hasEnergyDataset.
  // The two user demos link PT15M series; the two investor demos link P1Y
  // annual — and the first user demo (Lange Gasse) carries BOTH shapes, the
  // constellation that surfaces the Annual | Time series toggle.
  const bodies = buildingPuts.map((c) => c.body ?? "");
  assert.equal(
    bodies.filter((b) => b.includes("hasEnergyDataset") && b.includes("PT15M"))
      .length,
    2,
    "two buildings link a PT15M series dataset (the user demos)",
  );
  assert.equal(
    bodies.filter((b) => b.includes("hasEnergyDataset") && b.includes("-P1Y"))
      .length,
    3,
    "three buildings link P1Y annual datasets (the investors + the both-shapes user demo)",
  );
  assert.equal(
    bodies.filter((b) => b.includes("PT15M") && b.includes("-P1Y")).length,
    1,
    "exactly one demo carries BOTH shapes (annual + series → the resolution toggle)",
  );

  // The annual aggregate's figures live in their own cons:EnergyDataset resources
  // (unified metric IRIs), not inline in the building file.
  const annualFiles = calls
    .filter((c) => c.method === "PUT" && /\/energy\/\d{4}-P1Y\.ttl$/.test(c.url))
    .map((c) => c.body ?? "");
  assert.ok(annualFiles.length >= 1, "annual dataset resources written");
  assert.ok(
    annualFiles.some((b) => b.includes("ElectricityConsumption")),
    "an annual dataset declares cons:ElectricityConsumption",
  );

  // Self-operated demos (investor #1 and both user demos) carry operatedBy =
  // the seeding user's WebID — the shared operator group that makes the
  // Betreiber benchmark show on the demo data. The cold store (demo #2) stays
  // outside the group, so the set also demonstrates a building WITHOUT it.
  const operated = bodies.filter((b) => b.includes("operatedBy"));
  assert.equal(operated.length, 3, "three demo buildings are self-operated");
  assert.ok(
    operated.every((b) => b.includes(WEBID)),
    "operatedBy points at the seeding user's WebID",
  );

  // The two series demos are owner-occupiers (ownedBy = the seeding user); the
  // investor demos carry no ownedBy (their economic side is the fictional fund).
  const owned = bodies.filter((b) => b.includes("ownedBy"));
  assert.equal(owned.length, 2, "the two series demos are self-owned");

  // Demo #1 carries an extra planned (Soll) 2024 dataset next to the actual
  // 2024 figures — the out-of-the-box Soll-Ist pair.
  const plannedPuts = calls.filter((c) =>
    c.method === "PUT" && /\/energy\/2024-P1Y-planned\.ttl$/.test(c.url)
  );
  assert.equal(plannedPuts.length, 1, "one planned 2024 dataset written");
  assert.ok(
    (plannedPuts[0].body ?? "").includes("ElectricityConsumption"),
    "the planned dataset carries metric observations",
  );
  assert.equal(
    bodies.filter((b) => b.includes("2024-P1Y-planned.ttl#ds")).length,
    1,
    "exactly one building links the planned dataset",
  );

  // The building files carry a PROV qualified attribution to the producing agent,
  // but NO producing-role (prov:hadRole) — roles live only in data rooms now.
  const hadRoles = bodies
    .flatMap((b) =>
      parse(b).getQuads(null, namedNode(`${PROV_NS}hadRole`), null, null)
    );
  assert.equal(hadRoles.length, 0, "no building carries a prov:hadRole");

  // The investor demo building carries a fully-populated detail panel: core
  // master data, the investor block (incl. a controlled-vocab object property),
  // one certification, and operating costs. Round-trip through the parser so the
  // demo field NAMES stay in lockstep with buildingConfig (a rename breaks here).
  const investorBody = bodies.find((b) => b.includes("-P1Y")) ?? "";
  const inv = [...parseBuildings(new Parser().parse(investorBody)).values()][0];
  assert.ok(inv, "investor demo building parses");
  assert.equal(inv.customer, "Muster Logistik GmbH");
  assert.equal(inv.buildingCode, "NOP-84");
  assert.equal(inv.numberOfLoadingDocks, 14);
  assert.equal(inv.shiftRegime, "2-Shift"); // controlled vocab → label
  assert.equal(inv.tenancyType, "Multi Tenant");
  assert.equal(inv.indoorTemperatureClass, "≤18 °C");
  assert.equal(inv.hasHeatPump, true);
  const certs = inv.certifications as Array<{ type?: string; level?: string }>;
  assert.equal(certs?.length, 1, "one certification");
  assert.equal(certs[0].type, "DGNB");
  assert.equal(certs[0].level, "Gold");
  const opcosts = inv.operatingCosts as Record<string, unknown> | undefined;
  assert.equal(opcosts?.propertyManagement, "Medium");
  assert.equal(opcosts?.operationInspectionAndMaintenance, true);

  // The user demo building attributes its operator to the seeding user (WEBID),
  // so the agent-link → contact path resolves out of the box.
  const userBody = bodies.find((b) => b.includes("PT15M")) ?? "";
  const usr = [...parseBuildings(new Parser().parse(userBody)).values()][0];
  assert.equal(usr.operatedBy, WEBID, "user demo building operatedBy = seeder");
});

Deno.test("seedDemoBuildings counts a failed building instead of throwing — and never writes its building file (commit-last)", async () => {
  // Fail the planned (Soll) dataset PUT: it belongs to exactly one demo (demo #1),
  // and it is the only deterministically-addressable URL in the seed (building ids
  // are random UUIDs). The seed has no transactions; this asserts the substitute
  // guarantees: the loop continues, the tally reports the shortfall, and the failed
  // demo's discoverable building file is never written (its earlier dataset PUTs
  // become inert orphans).
  const { session, calls } = makeFakeSession({
    webId: WEBID,
    respond: (url, init) =>
      (init?.method ?? "GET").toUpperCase() === "PUT" &&
        url.endsWith("/energy/2024-P1Y-planned.ttl")
        ? new Response("boom", { status: 500 })
        : undefined,
  });

  // Stub the geocoder (global fetch) so the seed runs offline.
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("nominatim")) {
      return Promise.resolve(
        new Response(JSON.stringify([{ lat: "49.45", lon: "11.08" }]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("nope", { status: 404 }));
  }) as typeof fetch;

  let tally: { seeded: number; total: number };
  try {
    tally = await seedDemoBuildings(session, WEBID);
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.deepEqual(tally, { seeded: 3, total: 4 }, "partial seed reports 3/4");

  // Commit-last: the failed demo never reaches its building-file PUT, so only the
  // three healthy demos are discoverable (top-level *.ttl under buildings/).
  const buildingPuts = calls.filter((c) =>
    c.method === "PUT" &&
    /\/granergize\/buildings\/[^/]+\.ttl$/.test(c.url)
  );
  assert.equal(buildingPuts.length, 3, "failed demo's building file not written");
  assert.ok(
    buildingPuts.every((c) => !(c.body ?? "").includes("2024-P1Y-planned.ttl")),
    "no surviving building links the failed planned dataset",
  );
});

// ── delete a building (hard delete) ─────────────────────────────────────────────

Deno.test("deleteBuilding deletes the building file (de-registering it by listing)", async () => {
  const uri = newBuildingUri(WEBID, "gone");
  const { session, calls, store } = makeSession({
    [uri]: "<#gone> a <x> .",
  });

  await deleteBuilding(session, WEBID, `${uri}#gone`);

  assert.ok(!(uri in store), "building file was DELETEd");
  assert.ok(
    calls.some((c) => c.method === "DELETE" && c.url === uri),
    "a DELETE was issued for the building file",
  );

  // The building's own .acl is NOT deleted before the file: doing so would briefly
  // fall the resource back to the container's (possibly more permissive) inherited
  // ACL — a TOCTOU exposure window. The owner-lockout that would have motivated a
  // .acl-first "recovery" is prevented at the source (see removeFromACL).
  const fileDel = calls.findIndex((c) => c.method === "DELETE" && c.url === uri);
  const aclDelBefore = calls
    .slice(0, fileDel)
    .some((c) => c.method === "DELETE" && c.url === `${uri}.acl`);
  assert.ok(!aclDelBefore, "the building's .acl is NOT deleted before the file");
});

Deno.test("deleteBuilding refuses a building outside the user's own Pod", async () => {
  const { session } = makeSession();
  await assert.rejects(
    () =>
      deleteBuilding(
        session,
        WEBID,
        "https://other.example/granergize/buildings/x.ttl#x",
      ),
    /outside your own Pod/,
  );
});

// ── writeEnergyYear / deleteEnergyYear (the per-year energy entry round-trip) ──

Deno.test("writeEnergyYear writes the dataset and links it; deleteEnergyYear undoes both", async () => {
  const fileUri = newBuildingUri(WEBID, "b-e");
  const subjectUri = `${fileUri}#b-e`;
  // The building file must already exist (writeEnergyYear only adds a link).
  const { session, calls, store } = makeSession({
    [fileUri]: serializeBuildingToTurtle({ streetAddress: "X" }, fileUri),
  });

  await writeEnergyYear(session, fileUri, subjectUri, {
    building: subjectUri,
    year: 2099,
    granularity: "P1Y",
    scenario: "actual",
    metrics: { electricityConsumption: 88888 },
  });

  const dsFile = datasetFileUrl(fileUri, 2099, "P1Y", "actual");
  const dsNode = datasetNodeUrl(dsFile);
  assert.ok(dsFile in store, "the dataset resource was written");
  // The building file now links the dataset.
  const linkedAfterWrite = parse(store[fileUri]).getQuads(
    namedNode(subjectUri),
    namedNode(`${CONSUMPTION_NS}hasEnergyDataset`),
    namedNode(dsNode),
    null,
  );
  assert.equal(linkedAfterWrite.length, 1, "one hasEnergyDataset link after write");

  await deleteEnergyYear(session, fileUri, subjectUri, {
    year: 2099,
    granularity: "P1Y",
    scenario: "actual",
  });

  assert.ok(!(dsFile in store), "the dataset resource was deleted");
  assert.ok(
    calls.some((c) => c.method === "DELETE" && c.url === dsFile),
    "issued a DELETE for the dataset file",
  );
  const linkedAfterDelete = parse(store[fileUri]).getQuads(
    namedNode(subjectUri),
    namedNode(`${CONSUMPTION_NS}hasEnergyDataset`),
    namedNode(dsNode),
    null,
  );
  assert.equal(linkedAfterDelete.length, 0, "the link was removed from the building");
});

Deno.test("deleteEnergyYear tolerates an already-missing dataset (404) and skips the PUT when nothing is linked", async () => {
  const fileUri = newBuildingUri(WEBID, "b-gone");
  const subjectUri = `${fileUri}#b-gone`;
  // Building file with NO energy link; the dataset file doesn't exist either.
  const { session, calls } = makeSession({
    [fileUri]: serializeBuildingToTurtle({ streetAddress: "X" }, fileUri),
  });

  await deleteEnergyYear(session, fileUri, subjectUri, {
    year: 2050,
    granularity: "P1Y",
    scenario: "planned",
  });

  // The DELETE returns 404 (tolerated, no throw) and, with no link to remove,
  // the building file is never re-PUT.
  assert.ok(
    !calls.some((c) => c.method === "PUT" && c.url === fileUri),
    "no needless PUT of the building file when there was nothing to unlink",
  );
});

/** A session whose `buildings/` listing optionally lags by `lagReads` reads after a
 * DELETE before it drops the deleted file — models CSS container eventual
 * consistency. Energy sub-container GETs 404 (no series). Returns the live read
 * counters so a test can assert how the read-after-write polled. */
function deletingSession(uri: string, lagReads: number) {
  const container = uri.replace(/[^/]+$/, "");
  const other = `${container}other.ttl`;
  const counts = { containerGets: 0, deletes: 0 };
  const listing = (present: boolean) =>
    `@prefix ldp: <http://www.w3.org/ns/ldp#> .\n<${container}> ldp:contains ${
      present ? `<${uri}>, ` : ""
    }<${other}> .\n`;
  const { session } = makeFakeSession({
    webId: WEBID,
    // Everything not handled here (e.g. the energy/ probe) falls through to
    // the empty store's 404.
    respond: (url, init) => {
      if ((init?.method ?? "GET").toUpperCase() === "DELETE") {
        counts.deletes++;
        return new Response(null, { status: 205 });
      }
      if (url === container) {
        counts.containerGets++;
        // Still lists the deleted file for the first `lagReads` reads, then drops it.
        return new Response(listing(counts.containerGets <= lagReads), {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        });
      }
      return undefined;
    },
  });
  return { session, counts };
}

Deno.test("deleteBuilding waits until the buildings listing drops the deleted file (read-after-write)", async () => {
  const uri = newBuildingUri(WEBID, "b-del");
  // The listing lags for two reads (still lists the file), then drops it.
  const { session, counts } = deletingSession(uri, 2);
  await deleteBuilding(session, WEBID, uri);
  assert.equal(counts.deletes, 1, "issued the DELETE");
  // Polled past the lag: read the listing until the deleted file was gone.
  assert.ok(
    counts.containerGets >= 3,
    `polled the listing past the lag (${counts.containerGets} reads)`,
  );
});

Deno.test("deleteBuilding returns promptly when the listing already reflects the delete", async () => {
  const uri = newBuildingUri(WEBID, "b-del");
  const { session, counts } = deletingSession(uri, 0); // no lag
  await deleteBuilding(session, WEBID, uri);
  assert.equal(counts.deletes, 1, "issued the DELETE");
  assert.equal(counts.containerGets, 1, "one listing read, no extra polling");
});

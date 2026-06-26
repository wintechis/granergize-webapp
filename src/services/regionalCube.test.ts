/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { parseRdfText } from "./rdf/rdfHelpers.ts";
const store = (ttl: string, base: string) => parseRdfText(ttl, base);
import {
  parseRegionalChoropleth,
  parseRegionalObservations,
  REGIONAL_TABLES,
  regionalGeoUrl,
  type RegionalTable,
} from "./regionalCube.ts";

const landTable = (): RegionalTable =>
  REGIONAL_TABLES.find((t) => t.tableId === "86251-Z-02")!;
const kreisTable = (): RegionalTable =>
  REGIONAL_TABLES.find((t) => t.tableId === "43531-01-02-4")!;

// --- Land grain: 86251-Z-02 ("renewable electricity share") ------------------
// Geo dimension is #dim-geo → …/ags/{code}; single series per (region, year).
const LAND_BASE = "https://wunderfacts.com/regionalstatistik/data/86251-Z-02";
const LAND_FIXTURE = `
@prefix qb: <http://purl.org/linked-data/cube#> .
@prefix ds: <https://wunderfacts.com/regionalstatistik/ds/86251-Z-02#> .
@prefix ags: <https://wunderfacts.com/regionalstatistik/ags/> .

<#obs-1> a qb:Observation ;
  ds:dim-geo ags:09 ; ds:dim-TIME_PERIOD "2023" ;
  ds:measure-OBS_VALUE 61.5 ; ds:unit "Prozent" .
<#obs-2> a qb:Observation ;
  ds:dim-geo ags:09 ; ds:dim-TIME_PERIOD "2021" ;
  ds:measure-OBS_VALUE 55.0 ; ds:unit "Prozent" .
<#obs-3> a qb:Observation ;
  ds:dim-geo ags:12 ; ds:dim-TIME_PERIOD "2023" ;
  ds:measure-OBS_VALUE 88.0 ; ds:unit "Prozent" .
`;

Deno.test("land table: filters by AGS, sorts by year, carries unit", () => {
  const bayern = parseRegionalObservations(store(LAND_FIXTURE, LAND_BASE), landTable(), "09");
  assert.deepEqual(bayern, [
    { year: 2021, value: 55.0, unit: "Prozent" },
    { year: 2023, value: 61.5, unit: "Prozent" },
  ]);
});

Deno.test("land table: a different region selects only its rows", () => {
  const bb = parseRegionalObservations(store(LAND_FIXTURE, LAND_BASE), landTable(), "12");
  assert.equal(bb.length, 1);
  assert.equal(bb[0].value, 88.0);
});

Deno.test("land table: unknown region / no observations → empty", () => {
  assert.deepEqual(parseRegionalObservations(store(LAND_FIXTURE, LAND_BASE), landTable(), "99"), []);
  assert.deepEqual(parseRegionalObservations(store("@prefix x: <urn:x#> .", LAND_BASE), landTable(), "09"), []);
});

// --- Kreis grain: 43531-01-02-4 (industrial energy use) ----------------------
// Different geo dimension (#dim-DINSG → …/cl/DINSG#{code}) AND an extra carrier
// dimension (#dim-ENRNW1) the table fixes to ENRGTRNW4 (= renewable energy). The
// parser must pick the Kreis 09564 + the renewable carrier only.
const KREIS_BASE = "https://wunderfacts.com/regionalstatistik/data/43531-01-02-4";
const KREIS_FIXTURE = `
@prefix qb: <http://purl.org/linked-data/cube#> .
@prefix ds: <https://wunderfacts.com/regionalstatistik/ds/43531-01-02-4#> .
@prefix cl: <https://wunderfacts.com/regionalstatistik/cl/> .

# Nürnberg (09564), renewable carrier, 2024 — the wanted row.
<#o1> a qb:Observation ;
  ds:dim-DINSG cl:DINSG-09564 ; ds:dim-ENRNW1 cl:ENRNW1-ENRGTRNW4 ;
  ds:dim-TIME_PERIOD "2024" ; ds:measure-OBS_VALUE 1234 ; ds:unit "Tsd. MJ" .
# Nürnberg, but a DIFFERENT carrier (Heizöl) — must be excluded by the selector.
<#o2> a qb:Observation ;
  ds:dim-DINSG cl:DINSG-09564 ; ds:dim-ENRNW1 cl:ENRNW1-ENRGTRNW2 ;
  ds:dim-TIME_PERIOD "2024" ; ds:measure-OBS_VALUE 9999 ; ds:unit "Tsd. MJ" .
# A different Kreis (08221), renewable carrier — excluded by geo.
<#o3> a qb:Observation ;
  ds:dim-DINSG cl:DINSG-08221 ; ds:dim-ENRNW1 cl:ENRNW1-ENRGTRNW4 ;
  ds:dim-TIME_PERIOD "2024" ; ds:measure-OBS_VALUE 5555 ; ds:unit "Tsd. MJ" .
`;

// n3 needs a '#' fragment for the codelist concept; use a hyphen alias above and
// rewrite to the real `#` form so endsWith("#09564") / endsWith("#ENRGTRNW4") hit.
const KREIS_TTL = KREIS_FIXTURE
  .replace(/cl:DINSG-(\d+)/g, "<https://wunderfacts.com/regionalstatistik/cl/DINSG#$1>")
  .replace(/cl:ENRNW1-(\w+)/g, "<https://wunderfacts.com/regionalstatistik/cl/ENRNW1#$1>");

Deno.test("kreis table: alternate geo dim + carrier selector pick one series", () => {
  const rows = parseRegionalObservations(store(KREIS_TTL, KREIS_BASE), kreisTable(), "09564");
  assert.deepEqual(rows, [{ year: 2024, value: 1234, unit: "Tsd. MJ" }]);
});

Deno.test("kreis table: a Kreis with no renewable row → empty", () => {
  // 08221 only appears with the renewable carrier here, so it DOES match — assert
  // instead that an absent Kreis yields nothing.
  assert.deepEqual(parseRegionalObservations(store(KREIS_TTL, KREIS_BASE), kreisTable(), "09999"), []);
});

// --- regionalGeoUrl: the place's dereferenceable IRI (the leaf handoff) -------

Deno.test("regionalGeoUrl: ags-style land grain → …/ags/{code}", () => {
  assert.equal(
    regionalGeoUrl(landTable(), "09"),
    "https://wunderfacts.com/regionalstatistik/ags/09",
  );
});

Deno.test("regionalGeoUrl: frag-style kreis grain → …/cl/{scheme}#{code}", () => {
  assert.equal(
    regionalGeoUrl(kreisTable(), "09564"),
    "https://wunderfacts.com/regionalstatistik/cl/DINSG#09564",
  );
});

// --- parseRegionalChoropleth: one value per region (the whole-table read) ----

Deno.test("choropleth: ags-style → latest year per region, keyed by AGS", () => {
  const m = parseRegionalChoropleth(store(LAND_FIXTURE, LAND_BASE), landTable());
  assert.equal(m.size, 2);
  // 09 has 2021 + 2023 → keeps the latest (2023).
  assert.deepEqual(m.get("09"), { year: 2023, value: 61.5, unit: "Prozent" });
  assert.deepEqual(m.get("12"), { year: 2023, value: 88.0, unit: "Prozent" });
});

Deno.test("choropleth: maxYear caps the chosen year per region", () => {
  const m = parseRegionalChoropleth(store(LAND_FIXTURE, LAND_BASE), landTable(), 2021);
  // 09's 2023 is excluded → falls back to 2021; 12 only has 2023 → dropped.
  assert.deepEqual(m.get("09"), { year: 2021, value: 55.0, unit: "Prozent" });
  assert.equal(m.has("12"), false);
});

Deno.test("choropleth: frag-style geo + selector → AGS-keyed, carrier-filtered", () => {
  const m = parseRegionalChoropleth(store(KREIS_TTL, KREIS_BASE), kreisTable());
  // Both Kreise appear with the renewable carrier; the Heizöl row (o2) is excluded.
  assert.deepEqual(m.get("09564"), { year: 2024, value: 1234, unit: "Tsd. MJ" });
  assert.deepEqual(m.get("08221"), { year: 2024, value: 5555, unit: "Tsd. MJ" });
  assert.equal(m.size, 2);
});

Deno.test("choropleth: no observations → empty map", () => {
  assert.equal(parseRegionalChoropleth(store("@prefix x: <urn:x#> .", LAND_BASE), landTable()).size, 0);
});

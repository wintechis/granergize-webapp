/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { parseRegionalObservations } from "./regionalCube.ts";

// A faithful slice of an 86251-Z-02 ("renewable electricity share") cube: the
// dimension/measure predicates are table-scoped under …/ds/{table}# and matched
// by suffix; the geo dimension points at …/ags/{code}. Two regions (09 Bayern,
// 12 Brandenburg) × two years, deliberately out of year order.
const BASE = "https://wunderfacts.com/regionalstatistik/data/86251-Z-02";
const FIXTURE = `
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

Deno.test("parseRegionalObservations: filters by AGS, sorts by year, carries unit", () => {
  const bayern = parseRegionalObservations(FIXTURE, BASE, "09");
  assert.deepEqual(bayern, [
    { year: 2021, value: 55.0, unit: "Prozent" },
    { year: 2023, value: 61.5, unit: "Prozent" },
  ]);
});

Deno.test("parseRegionalObservations: a different region selects only its rows", () => {
  const brandenburg = parseRegionalObservations(FIXTURE, BASE, "12");
  assert.equal(brandenburg.length, 1);
  assert.equal(brandenburg[0].value, 88.0);
});

Deno.test("parseRegionalObservations: unknown region → empty", () => {
  assert.deepEqual(parseRegionalObservations(FIXTURE, BASE, "99"), []);
});

Deno.test("parseRegionalObservations: no observations → empty", () => {
  assert.deepEqual(parseRegionalObservations("@prefix x: <urn:x#> .", BASE, "09"), []);
});

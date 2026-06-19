/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { DataFactory, Parser, Store } from "n3";
import { parseNearbyInstallations } from "../mastrNearby.ts";
import { serializeBuildingToTurtle } from "./building/buildingSerializer.ts";
import { parseBuildings } from "./building/buildingParser.ts";

const { namedNode } = DataFactory;

// The MaStR unit's own IRI, as the linked-mastr wrapper mints it (…/see/{id}#it).
const MASTR_UNIT = "https://wunderfacts.com/mastr/see/100#it";
const MASTR_BASE = "https://wunderfacts.com/mastr/";
// Gross capacity (Bruttoleistung) — the facet the per-unit /see deref carries
// (the bbox listing omits it); same `mastr#` namespace as Energietraeger.
const BRUTTOLEISTUNG = "https://wunderfacts.com/mastr/mastr#Bruttoleistung";

/**
 * Modelling-alignment guard: a MaStR per-unit record and our building energy-unit
 * node (`<#pv>` `bldg:PVSystem`) map **1:1 on the shape** — the same facets, the
 * same values — so our `owl:sameAs` cross-link is meaningful and both registers
 * describe the SAME installation the same way. Uses the REAL parsers on each side
 * (`parseNearbyInstallations` ↔ `parseBuildings`), so the predicate table below is
 * an enforced contract: if either model drifts (a renamed predicate, a changed
 * carrier mapping, a unit class rename) this fails.
 *
 * The 1:1 mapping asserted (MaStR facet → our predicate):
 *   - unit IRI `…/see/{id}#it`        → `owl:sameAs`
 *   - `mastr:Energietraeger "2495"`   → `rdf:type bldg:PVSystem`  (solar carrier)
 *   - `geo:lat` / `geo:long`          → the building's geo (same location)
 *   - `mastr:Bruttoleistung` (kW)     → `bldg:capacityKW` (kW)
 */
Deno.test("a MaStR PV unit maps 1:1 onto our :PVSystem node (shape in-line)", () => {
  // --- MaStR side: a solar unit as the wrapper serves it (bbox facets + the
  // Bruttoleistung the /see deref adds). 2495 = Solare Strahlungsenergie. ---
  const mastrTtl = `@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix geo: <http://www.w3.org/2003/01/geo/wgs84_pos#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix mastr: <https://wunderfacts.com/mastr/mastr#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<${MASTR_UNIT}>
  rdfs:label "PV Roof A" ;
  geo:lat 49.4540 ; geo:long 11.0780 ;
  dcterms:spatial <https://wunderfacts.com/mastr/ags/09564000#it> ;
  mastr:Energietraeger "2495" ;
  mastr:Bruttoleistung "750"^^xsd:decimal .
`;
  const [unit] = parseNearbyInstallations(mastrTtl, MASTR_BASE, 49.454, 11.078);
  assert.ok(unit, "the MaStR parser recognised the solar unit");

  // --- Our side: a building whose <#pv> IS that same installation. ---
  const uri = "https://pod.example/granergize/buildings/pv-1.ttl";
  const ttl = serializeBuildingToTurtle({
    streetAddress: "Roofweg 1",
    locality: "Nürnberg",
    lat: "49.4540",
    long: "11.0780",
    _pv_capacityKW: "750",
    _pv_commissioningYear: "2018",
    _pv_sameAs: MASTR_UNIT,
  }, uri);
  const b = parseBuildings(new Parser().parse(ttl)).get(`${uri}#it`);
  assert.ok(b?.pvSystem, "our parser typed the unit as a PV system");

  // --- The 1:1 mapping ---
  // unit IRI            ↔ owl:sameAs   (the cross-link points at THIS MaStR unit)
  assert.equal(b!.pvSystem!.sameAs, unit.iri);
  // Energietraeger 2495 ↔ rdf:type :PVSystem  (solar carrier ⇒ a PV system both sides)
  assert.equal(unit.kind, "solar");
  // geo:lat / geo:long  ↔ the building's geo (same location)
  assert.equal(b!.lat, unit.lat);
  assert.equal(b!.long, unit.long);
  // mastr:Bruttoleistung ↔ bldg:capacityKW  (same gross capacity, kW both sides)
  const brutto = Number(
    new Store(new Parser().parse(mastrTtl))
      .getObjects(namedNode(MASTR_UNIT), namedNode(BRUTTOLEISTUNG), null)[0]?.value,
  );
  assert.equal(brutto, b!.pvSystem!.capacityKW);
});

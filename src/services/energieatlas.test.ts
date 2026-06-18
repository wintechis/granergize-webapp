/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { areaPotentialUrl, parseAreaPotential } from "./energieatlas.ts";

const BASE = "https://wunderfacts.com/energieatlas/area/09162000";
const FIXTURE = `
@prefix geo:   <http://www.opengis.net/ont/geosparql#> .
@prefix rdf:   <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix skos:  <http://www.w3.org/2004/02/skos/core#> .
@prefix vocab: <https://wunderfacts.com/energieatlas/vocab#> .
@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .

<#it>   rdf:type                      vocab:AreaPotential ;
        rdfs:label                    "München" ;
        skos:notation                 "09162000"^^xsd:token ;
        vocab:name                    "München" ;
        vocab:developmentDegreePct    7.5 ;
        vocab:pvPotentialCapacityMWp  2620.0 ;
        vocab:installedCapacityMWp    196.0 ;
        vocab:remainingPotentialMWp   2424.0 .
`;

Deno.test("parseAreaPotential: reads the AGS, name + rooftop-PV figures", () => {
  const p = parseAreaPotential(FIXTURE, BASE);
  assert.ok(p);
  assert.equal(p.ags, "09162000");
  assert.equal(p.name, "München");
  assert.equal(p.developmentDegreePct, 7.5);
  assert.equal(p.pvPotentialCapacityMWp, 2620.0);
  assert.equal(p.installedCapacityMWp, 196.0);
  assert.equal(p.remainingPotentialMWp, 2424.0);
});

Deno.test("parseAreaPotential: missing fields → null, no AreaPotential → null", () => {
  const p = parseAreaPotential(
    `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
     @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
     @prefix vocab: <https://wunderfacts.com/energieatlas/vocab#> .
     <#it> rdf:type vocab:AreaPotential ; skos:notation "09999999" .`,
    BASE,
  );
  assert.ok(p);
  assert.equal(p.ags, "09999999");
  assert.equal(p.developmentDegreePct, null);
  assert.equal(p.pvPotentialCapacityMWp, null);

  assert.equal(parseAreaPotential("@prefix x: <urn:x#> .", BASE), null);
});

Deno.test("areaPotentialUrl: builds the area resource IRI", () => {
  assert.equal(areaPotentialUrl("09162000"), "https://wunderfacts.com/energieatlas/area/09162000");
});

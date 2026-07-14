/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { parseRdfText } from "../rdf/rdfHelpers.ts";
const store = (ttl: string, base: string) => parseRdfText(ttl, base);
import { parsePlantSettlements } from "./netztransparenz.ts";

// A faithful slice of a linked-netztransparenz plant document: one `vocab:Settlement`
// per (year × Veräußerungsform), each with `strommengeKWh` + `year`. 2023 has two
// disposal forms (must SUM to one annual figure); 2024 has one. Predicates are the
// relative `../vocab#…` the wrapper serves — matched by suffix, base-independent.
const BASE = "https://wunderfacts.com/netztransparenz/eeg/920239138957";
const FIXTURE = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<#it> rdf:type <../vocab#Plant> ;
  <../vocab#energySource> "Solar" ;
  <../vocab#hasSettlement>
    [ rdf:type <../vocab#Settlement> ; <../vocab#disposalForm> "feed-in-tariff" ;
      <../vocab#strommengeKWh> 7000 ; <../vocab#year> "2023"^^xsd:gYear ] ,
    [ rdf:type <../vocab#Settlement> ; <../vocab#disposalForm> "self-consumption-or-other-dv" ;
      <../vocab#strommengeKWh> 255 ; <../vocab#year> "2023"^^xsd:gYear ] ,
    [ rdf:type <../vocab#Settlement> ; <../vocab#disposalForm> "market-premium" ;
      <../vocab#strommengeKWh> 93718 ; <../vocab#year> "2024"^^xsd:gYear ] .
`;

Deno.test("parsePlantSettlements: sums strommengeKWh per year across disposal forms", () => {
  const byYear = parsePlantSettlements(store(FIXTURE, BASE));
  assert.equal(byYear.size, 2);
  assert.equal(byYear.get(2023), 7255); // 7000 + 255 across two disposal forms
  assert.equal(byYear.get(2024), 93718);
});

Deno.test("parsePlantSettlements: an empty document → an empty map", () => {
  assert.equal(parsePlantSettlements(store("", BASE)).size, 0);
});

Deno.test("parsePlantSettlements: decimal kWh amounts keep their fraction", () => {
  // The settled dump carries decimals; parseInt would silently truncate them.
  const ttl = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
<#it> rdf:type <../vocab#Plant> ;
  <../vocab#hasSettlement>
    [ rdf:type <../vocab#Settlement> ; <../vocab#disposalForm> "feed-in-tariff" ;
      <../vocab#strommengeKWh> "1234.56"^^xsd:decimal ; <../vocab#year> "2023"^^xsd:gYear ] ,
    [ rdf:type <../vocab#Settlement> ; <../vocab#disposalForm> "market-premium" ;
      <../vocab#strommengeKWh> "0.44"^^xsd:decimal ; <../vocab#year> "2023"^^xsd:gYear ] .
`;
  const byYear = parsePlantSettlements(store(ttl, BASE));
  assert.equal(byYear.get(2023), 1235);
});

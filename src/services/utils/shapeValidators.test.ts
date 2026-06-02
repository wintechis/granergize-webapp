/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { parseRdfText } from "./rdfHelpers.ts";
import {
  validateAggregatedViewDefinitions,
  validateAggregatedViewSnapshot,
  validateDataSourcesRegistry,
  validateHiddenBuildings,
  validateSharingRegistry,
  validateViewSharingRegistry,
} from "./shapeValidators.ts";

const g = (ttl: string) => parseRdfText(ttl, "https://pod.example/doc.ttl");

const PREFIXES = `
@prefix gran: <https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
`;

Deno.test("DataSourcesRegistry: IRIs valid, literal role invalid", () => {
  const valid = g(`${PREFIXES}
<https://pod.example/granergize/dataSources.ttl> a gran:DataSourceRegistry ;
  dcterms:creator <https://pod.example/profile/card#me> ;
  gran:hasBuildingDataSource <https://pod.example/granergize/buildings/b1.ttl> ;
  gran:hasAgentDataSource <https://pod.example/granergize/agents.ttl> .
<https://pod.example/granergize/buildings/b1.ttl> gran:dataSourceRole gran:DummyRole .
`);
  assert.ok(validateDataSourcesRegistry(valid).valid);

  const bad = g(`${PREFIXES}
<https://pod.example/granergize/buildings/b1.ttl> gran:dataSourceRole "dummy" .
`);
  const r = validateDataSourcesRegistry(bad);
  assert.equal(r.valid, false);
  assert.ok(r.problems.some((p) => p.includes("dataSourceRole")));
});

Deno.test("HiddenBuildings: building IRIs valid, literal invalid", () => {
  assert.ok(
    validateHiddenBuildings(g(`${PREFIXES}
<https://pod.example/granergize/hiddenBuildings.ttl>
  gran:hiddenBuilding <https://other.example/b.ttl#b> .
`)).valid,
  );
  assert.equal(
    validateHiddenBuildings(g(`${PREFIXES}
<#x> gran:hiddenBuilding "not-an-iri" .
`)).valid,
    false,
  );
});

Deno.test("SharingRegistry: recipient IRIs valid, literal invalid", () => {
  assert.ok(
    validateSharingRegistry(g(`${PREFIXES}
<https://pod.example/b.ttl#b> gran:sharedWith <https://her.example/card#me> .
`)).valid,
  );
  assert.equal(
    validateSharingRegistry(g(`${PREFIXES}
<https://pod.example/b.ttl#b> gran:sharedWith "bob" .
`)).valid,
    false,
  );
});

Deno.test("ViewSharingRegistry: sharedWith IRI + viewId literal valid", () => {
  assert.ok(
    validateViewSharingRegistry(g(`${PREFIXES}
<https://pod.example/views/computed/v1.ttl> gran:sharedWith <https://her.example/card#me> ;
  gran:viewId "v1" .
`)).valid,
  );
  // viewId must be a literal, not an IRI.
  assert.equal(
    validateViewSharingRegistry(g(`${PREFIXES}
<https://pod.example/views/computed/v1.ttl> gran:viewId <https://pod.example/v1> .
`)).valid,
    false,
  );
});

Deno.test("AggregatedViewDefinition: needs viewId; building refs are IRIs", () => {
  const valid = g(`${PREFIXES}
<https://pod.example/views/viewDefinitions.ttl#v1> a gran:AggregatedViewDefinition ;
  gran:viewId "v1" ;
  gran:viewName "My view" ;
  gran:createdAt "2024-01-01T00:00:00Z"^^xsd:dateTime ;
  gran:includesBuilding <https://pod.example/granergize/buildings/b1.ttl#b1> ;
  gran:includesMetric "electricity" .
`);
  assert.ok(validateAggregatedViewDefinitions(valid).valid);

  const missingId = g(`${PREFIXES}
<#v2> a gran:AggregatedViewDefinition ; gran:viewName "No id" .
`);
  const r = validateAggregatedViewDefinitions(missingId);
  assert.equal(r.valid, false);
  assert.ok(r.problems.some((p) => p.includes("viewId")));

  const badBuilding = g(`${PREFIXES}
<#v3> a gran:AggregatedViewDefinition ; gran:viewId "v3" ;
  gran:includesBuilding "not-an-iri" .
`);
  assert.equal(validateAggregatedViewDefinitions(badBuilding).valid, false);
});

Deno.test("AggregatedViewSnapshot: computedAt must be a literal", () => {
  assert.ok(
    validateAggregatedViewSnapshot(g(`${PREFIXES}
<https://pod.example/views/computed/v1.ttl#snap> a gran:AggregatedViewSnapshot ;
  gran:viewId "v1" ;
  gran:computedAt "2024-01-01T00:00:00Z"^^xsd:dateTime .
`)).valid,
  );
  assert.equal(
    validateAggregatedViewSnapshot(g(`${PREFIXES}
<#snap> gran:computedAt <https://pod.example/when> .
`)).valid,
    false,
  );
});

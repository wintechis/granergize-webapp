/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { DataFactory } from "n3";
import {
  clearRdfDataset,
  recordGraph,
} from "./rdfDataset.ts";
import {
  openSourceForGraph,
  provenanceRecordFor,
  tierOfGraph,
} from "./provenanceRecord.ts";
import { beginActivity, endActivity } from "../../lib/networkActivity.ts";

const { namedNode, literal, blankNode, quad } = DataFactory;

const ROOT = "https://pod.example/";
const OWN_DOC = `${ROOT}granergize/buildings/a.ttl`;
const SUBJECT = `${OWN_DOC}#it`;
const FOREIGN_DOC = "https://other.example/granergize/buildings/x.ttl";
const OPEN_DOC = "https://wunderfacts.com/energieatlas/area/09576151";

function ownQuads() {
  const attr = blankNode("a1");
  return [
    quad(
      namedNode(SUBJECT),
      namedNode("http://www.w3.org/2000/01/rdf-schema#label"),
      literal("Hall A"),
      namedNode(OWN_DOC),
    ),
    quad(
      namedNode(SUBJECT),
      namedNode("http://www.w3.org/ns/prov#qualifiedAttribution"),
      attr,
      namedNode(OWN_DOC),
    ),
    quad(
      attr,
      namedNode("http://www.w3.org/ns/prov#agent"),
      namedNode("https://me.example/profile/card#me"),
      namedNode(OWN_DOC),
    ),
  ];
}

Deno.test("tierOfGraph: storage root → mine; wrapper base → open; else shared", () => {
  assert.equal(tierOfGraph(OWN_DOC, ROOT), "mine");
  assert.equal(tierOfGraph(OPEN_DOC, ROOT), "open");
  assert.equal(tierOfGraph(FOREIGN_DOC, ROOT), "shared");
  assert.equal(tierOfGraph(OWN_DOC), "shared", "no root → conservative shared");
});

Deno.test("openSourceForGraph resolves the registry entry by base", () => {
  assert.equal(openSourceForGraph(OPEN_DOC)?.id, "energieatlas");
  assert.equal(openSourceForGraph(OWN_DOC), undefined);
});

Deno.test("provenanceRecordFor joins registry, tiers, and PROV statements", () => {
  clearRdfDataset();
  recordGraph(OWN_DOC, ownQuads());
  const record = provenanceRecordFor(SUBJECT, { storageRoot: ROOT });
  assert.equal(record.sources.length, 1);
  assert.equal(record.sources[0].graphIri, OWN_DOC);
  assert.equal(record.sources[0].tier, "mine");
  assert.ok(record.sources[0].retrievedAt, "registry timestamp present");
  // 3 statements about the subject (incl. bnode closure), 2 of them PROV.
  assert.equal(record.statements.length, 3);
  assert.equal(record.provStatements.length, 2);
  clearRdfDataset();
});

Deno.test("provenanceRecordFor: explicit sources pin the document set", () => {
  clearRdfDataset();
  recordGraph(OWN_DOC, ownQuads());
  const record = provenanceRecordFor(SUBJECT, {
    storageRoot: ROOT,
    sources: [OPEN_DOC],
  });
  assert.deepEqual(
    record.sources.map((s) => s.graphIri),
    [OPEN_DOC],
    "the pinned set wins over mention lookup",
  );
  assert.equal(record.sources[0].tier, "open");
  assert.equal(record.sources[0].retrievedAt, null, "never parsed → no timestamp");
  clearRdfDataset();
});

Deno.test("provenanceRecordFor: several subjects merge their statements", () => {
  clearRdfDataset();
  recordGraph(OWN_DOC, ownQuads());
  const attrAgent = "https://me.example/profile/card#me";
  const record = provenanceRecordFor([SUBJECT, attrAgent], {
    storageRoot: ROOT,
  });
  assert.deepEqual(record.subjectIris, [SUBJECT, attrAgent]);
  // The agent appears as an object in OWN_DOC → the graph is found once.
  assert.deepEqual(record.sources.map((s) => s.graphIri), [OWN_DOC]);
  assert.equal(record.statements.length, 3, "subject statements merged");
  clearRdfDataset();
});

Deno.test("provenanceRecordFor: empty subjects + pinned sources = document-level", () => {
  clearRdfDataset();
  recordGraph(OWN_DOC, ownQuads());
  const record = provenanceRecordFor([], { storageRoot: ROOT, sources: [OWN_DOC] });
  assert.deepEqual(record.subjectIris, []);
  assert.equal(record.sources[0].graphIri, OWN_DOC);
  assert.equal(record.statements.length, 3, "the whole graph is the record");
  assert.equal(record.provStatements.length, 2);
  clearRdfDataset();
});

Deno.test("provenanceRecordFor joins the request log by document URL", () => {
  clearRdfDataset();
  recordGraph(OWN_DOC, ownQuads());
  const id = beginActivity("GET buildings/a.ttl", OWN_DOC);
  endActivity(id, { status: 200 });
  const record = provenanceRecordFor(SUBJECT, { storageRoot: ROOT });
  assert.equal(record.sources[0].lastRequest?.status, 200);
  assert.equal(record.sources[0].lastRequest?.url, OWN_DOC);
  clearRdfDataset();
});

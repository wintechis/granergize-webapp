/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { DataFactory } from "n3";
import {
  clearRdfDataset,
  getGraphQuads,
  graphRetrievedAt,
  graphsMentioning,
  listGraphIris,
  quadsAbout,
  recordGraph,
} from "./rdfDataset.ts";

const { namedNode, literal, blankNode, quad } = DataFactory;

const DOC_A = "https://pod.example/granergize/buildings/a.ttl";
const DOC_B = "https://pod.example/granergize/buildings/b.ttl";
const SUBJECT = `${DOC_A}#it`;
const OTHER = `${DOC_B}#it`;

function graphA() {
  const attribution = blankNode("attr");
  return [
    quad(
      namedNode(SUBJECT),
      namedNode("http://www.w3.org/2000/01/rdf-schema#label"),
      literal("Hall A"),
      namedNode(DOC_A),
    ),
    quad(
      namedNode(SUBJECT),
      namedNode("http://www.w3.org/ns/prov#qualifiedAttribution"),
      attribution,
      namedNode(DOC_A),
    ),
    quad(
      attribution,
      namedNode("http://www.w3.org/ns/prov#agent"),
      namedNode("https://me.example/profile/card#me"),
      namedNode(DOC_A),
    ),
  ];
}

function graphB() {
  return [
    quad(
      namedNode(OTHER),
      namedNode("https://w3id.org/rec#operatedBy"),
      namedNode(SUBJECT), // mentions A's subject as an object
      namedNode(DOC_B),
    ),
  ];
}

Deno.test("recordGraph stores per graph IRI; re-record replaces", () => {
  clearRdfDataset();
  recordGraph(DOC_A, graphA());
  assert.equal(getGraphQuads(DOC_A)?.length, 3);
  assert.ok(graphRetrievedAt(DOC_A));

  recordGraph(DOC_A, graphA().slice(0, 1)); // refetch with fewer quads
  assert.equal(getGraphQuads(DOC_A)?.length, 1, "replace, not append");
  assert.deepEqual(listGraphIris(), [DOC_A]);
});

Deno.test("graphsMentioning finds subject and object mentions", () => {
  clearRdfDataset();
  recordGraph(DOC_A, graphA());
  recordGraph(DOC_B, graphB());
  assert.deepEqual(graphsMentioning(SUBJECT).sort(), [DOC_A, DOC_B].sort());
  assert.deepEqual(graphsMentioning(OTHER), [DOC_B]);
  assert.deepEqual(graphsMentioning("https://nowhere.example/x"), []);
});

Deno.test("quadsAbout follows blank-node closure within a graph", () => {
  clearRdfDataset();
  recordGraph(DOC_A, graphA());
  const about = quadsAbout(SUBJECT, DOC_A);
  // label + qualifiedAttribution + the attribution node's own prov:agent quad
  assert.equal(about.length, 3);
  assert.ok(
    about.some((q) => q.predicate.value === "http://www.w3.org/ns/prov#agent"),
    "blank-node attribution detail included",
  );
});

Deno.test("quadsAbout scopes to one graph or spans the dataset", () => {
  clearRdfDataset();
  recordGraph(DOC_A, graphA());
  recordGraph(DOC_B, graphB());
  assert.equal(quadsAbout(SUBJECT, DOC_A).length, 3);
  assert.equal(quadsAbout(SUBJECT, DOC_B).length, 0, "B only mentions it as object");
  assert.equal(quadsAbout(OTHER).length, 1, "unscoped spans all graphs");
  assert.equal(quadsAbout(SUBJECT, "https://nowhere.example/doc").length, 0);
});

Deno.test("clearRdfDataset empties the dataset", () => {
  clearRdfDataset();
  recordGraph(DOC_A, graphA());
  clearRdfDataset();
  assert.deepEqual(listGraphIris(), []);
  assert.equal(getGraphQuads(DOC_A), null);
  assert.equal(graphRetrievedAt(DOC_A), null);
});

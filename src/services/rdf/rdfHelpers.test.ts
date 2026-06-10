/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { DataFactory, Store } from "n3";
import { mintLocalIri, quadsToJsonLd } from "./rdfHelpers.ts";

const { namedNode, literal } = DataFactory;
const ACL = "http://www.w3.org/ns/auth/acl#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD = "http://www.w3.org/2001/XMLSchema#";

type Node = Record<string, unknown>;

Deno.test("quadsToJsonLd: a WAC authorization → compact JSON-LD node", () => {
  const store = new Store();
  const s = namedNode("http://pod/c/b.ttl.acl#Read_x");
  store.addQuad(s, namedNode(RDF_TYPE), namedNode(`${ACL}Authorization`));
  store.addQuad(s, namedNode(`${ACL}agent`), namedNode("http://other/profile/card#me"));
  store.addQuad(s, namedNode(`${ACL}accessTo`), namedNode("http://pod/c/b.ttl"));
  store.addQuad(s, namedNode(`${ACL}mode`), namedNode(`${ACL}Read`));
  store.addQuad(s, namedNode(`${ACL}mode`), namedNode(`${ACL}Write`));

  // Output is a bare ARRAY of node objects (NOT a @graph wrapper — JSS's
  // JSON-LD→Turtle path ignores @graph), each carrying the acl/foaf @context
  // so the CURIE keys are valid JSON-LD a real processor can expand.
  const doc = JSON.parse(quadsToJsonLd(store.getQuads(null, null, null, null))) as Node[];
  assert.equal(Array.isArray(doc), true);
  const node = doc.find((n) => n["@id"] === s.value)!;
  assert.ok(node, "subject node present");
  assert.equal((node["@context"] as Record<string, string>).acl, ACL);
  // rdf:type collapses to @type, compacted to a CURIE (array form).
  assert.deepEqual(node["@type"], ["acl:Authorization"]);
  // acl: predicate KEYS are CURIEs — the shape JSS's WAC parser recognizes.
  // The agent WebID is a foreign IRI → stays absolute; acl: terms compact.
  assert.deepEqual(node["acl:agent"], [{ "@id": "http://other/profile/card#me" }]);
  assert.deepEqual(node["acl:accessTo"], [{ "@id": "http://pod/c/b.ttl" }]);
  assert.deepEqual(node["acl:mode"], [{ "@id": "acl:Read" }, { "@id": "acl:Write" }]);
  // No full-IRI predicate keys leak through.
  assert.equal(node[`${ACL}agent`], undefined);
});

Deno.test("quadsToJsonLd: literals carry datatype, xsd:string is implicit", () => {
  const store = new Store();
  const s = namedNode("http://pod/x");
  store.addQuad(s, namedNode("http://ex/n"), literal("5", namedNode(`${XSD}integer`)));
  store.addQuad(s, namedNode("http://ex/s"), literal("hi")); // plain → xsd:string

  const node = (JSON.parse(quadsToJsonLd(store.getQuads(null, null, null, null))) as Node[])[0];
  // Non-acl/foaf predicate IRIs stay absolute (no matching prefix).
  assert.deepEqual(node["http://ex/n"], [{ "@value": "5", "@type": `${XSD}integer` }]);
  assert.deepEqual(node["http://ex/s"], [{ "@value": "hi" }]); // xsd:string omitted
});

Deno.test("mintLocalIri: a valid local name mints <ns><local>", () => {
  assert.equal(mintLocalIri(ACL, "Read").value, `${ACL}Read`);
  assert.equal(mintLocalIri(ACL, "Read").termType, "NamedNode");
  // Digits, underscore and hyphen are fine after a leading letter.
  assert.equal(mintLocalIri("http://ex/", "A_b-2").value, "http://ex/A_b-2");
});

Deno.test("mintLocalIri: an IRI-unsafe local name throws (with the caller's hint)", () => {
  // Space, umlaut, slash, leading digit — each would mint an IRI that breaks
  // the containing file on its next parse.
  for (const bad of ["DGNB Gold", "Bürofläche", "a/b", "1shift", ""]) {
    assert.throws(() => mintLocalIri("http://ex/", bad), /not usable as an IRI local name/);
  }
  assert.throws(
    () => mintLocalIri("http://ex/", "x y", "use a known system"),
    /use a known system/,
  );
});

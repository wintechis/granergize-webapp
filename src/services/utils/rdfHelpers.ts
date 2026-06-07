import { Parser, Store } from "n3";
import type { Quad, Term } from "n3";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD_STRING = "http://www.w3.org/2001/XMLSchema#string";

function pushInto(obj: Record<string, unknown>, key: string, val: unknown): void {
  const arr = obj[key];
  if (Array.isArray(arr)) arr.push(val);
  else obj[key] = [val];
}

// Namespaces compacted when emitting JSON-LD ACLs (the sole use of
// quadsToJsonLd). WAC documents reference just the acl + foaf namespaces; any
// other IRI is left absolute (still valid JSON-LD).
const JSONLD_PREFIXES: Record<string, string> = {
  acl: "http://www.w3.org/ns/auth/acl#",
  foaf: "http://xmlns.com/foaf/0.1/",
};

/** Compact an IRI to a `prefix:local` CURIE when a known prefix matches, else
 *  return it unchanged. */
function compactIri(iri: string): string {
  for (const [prefix, ns] of Object.entries(JSONLD_PREFIXES)) {
    if (iri.startsWith(ns) && iri.length > ns.length) {
      return `${prefix}:${iri.slice(ns.length)}`;
    }
  }
  return iri;
}

/**
 * Serialize quads (default graph) to COMPACT JSON-LD — a `{ @context, @graph }`
 * document whose acl/foaf predicate, type, and term IRIs are written as CURIEs
 * (`acl:mode`, `foaf:Agent`). A write fallback for servers that reject Turtle
 * for certain resources: JSS demands `application/ld+json` for WAC `.acl` files
 * (CSS/NSS accept Turtle). See `readModifyWrite` (podWrite.ts), which retries
 * with this on a 415.
 *
 * Compact (not expanded) on purpose: JSS's hand-rolled WAC parser recognizes
 * only CURIE/bare predicate keys (`acl:mode`), never full-IRI keys, so an
 * expanded document would be STORED but enforced as zero grants — a silent 403
 * on every shared resource (and on the owner's own deletes of share-ACL'd
 * containers). Real JSON-LD parsers (CSS/NSS) accept either form, so compact is
 * strictly the more interoperable choice.
 *
 * Shape is an ARRAY of node objects (each carrying the `@context`), NOT a
 * `{ @context, @graph }` wrapper: JSS's WAC parser reads either, but its
 * JSON-LD→Turtle conversion (used when an `.acl` is read back to modify it, e.g.
 * to revoke a grant) ignores `@graph` and would yield an EMPTY graph — so a
 * revoke would read no grants and silently no-op, leaving access in place. The
 * array form round-trips through both paths.
 */
export function quadsToJsonLd(quads: Quad[]): string {
  const objValue = (o: Term): unknown => {
    if (o.termType === "NamedNode") return { "@id": compactIri(o.value) };
    if (o.termType === "BlankNode") return { "@id": `_:${o.value}` };
    const v: Record<string, unknown> = { "@value": o.value };
    const lang = (o as { language?: string }).language;
    const dt = (o as { datatype?: { value: string } }).datatype?.value;
    if (lang) v["@language"] = lang;
    else if (dt && dt !== XSD_STRING) v["@type"] = compactIri(dt);
    return v;
  };
  const nodes = new Map<string, Record<string, unknown>>();
  for (const q of quads) {
    const id = q.subject.termType === "BlankNode" ? `_:${q.subject.value}` : q.subject.value;
    let node = nodes.get(id);
    if (!node) nodes.set(id, node = { "@id": id });
    if (q.predicate.value === RDF_TYPE && q.object.termType === "NamedNode") {
      pushInto(node, "@type", compactIri(q.object.value));
    } else {
      pushInto(node, compactIri(q.predicate.value), objValue(q.object));
    }
  }
  // @context on every node so the document is valid JSON-LD as a bare array
  // (a top-level array has no place for a document-level context).
  return JSON.stringify(
    [...nodes.values()].map((n) => ({ "@context": JSONLD_PREFIXES, ...n })),
  );
}

/** Parse Turtle text into an n3 Store */
export function parseRdfText(text: string, baseIRI: string): Store {
  const parser = new Parser({ format: "text/turtle", baseIRI });
  return new Store(parser.parse(text));
}

/** Returns the first matching quad's object value, or undefined */
export function getQuadValue(
  store: Store,
  subject: Term | null,
  predicate: Term | null,
): string | undefined {
  return store.getQuads(subject, predicate, null, null)[0]?.object.value;
}

/** Returns all matching quads' object values */
export function getQuadValues(
  store: Store,
  subject: Term | null,
  predicate: Term | null,
): string[] {
  return store.getQuads(subject, predicate, null, null).map((q) =>
    q.object.value
  );
}

/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { Parser } from "n3";
import {
  BUILDING_FIELDS,
  investorLocalNameLabels,
} from "./config/buildingConfig.ts";
import {
  BENCH_NS,
  GRAN_NS,
  INVESTOR_NS,
  USERVOC_NS,
} from "./vocabularies.ts";

/**
 * Drift guard: the repo's vocab/*.ttl files are the source of truth for the
 * Granergize vocabularies (see vocab/README.md). This asserts that every term the
 * app reads/writes — the building field-schema predicates, the controlled-vocab
 * object-property ranges, and the controlled-vocab instances — is actually defined
 * in the matching file. Add a term in the code and this fails until it's defined,
 * so the published vocab can't silently desync from what the app writes.
 */

// Namespace IRI → vocab file (relative to repo root). Parsing each with its
// document IRI as base resolves `<#Foo>` to `<namespace>Foo`.
const NS_FILE: Record<string, string> = {
  [GRAN_NS]: "vocab/vocab.ttl",
  [INVESTOR_NS]: "vocab/investor-vocab.ttl",
  [BENCH_NS]: "vocab/benchmark-vocab.ttl",
  [USERVOC_NS]: "vocab/user-vocab.ttl",
};

/** All subject IRIs defined across the owned vocab files. */
const defined: Set<string> = new Set();
for (const [ns, file] of Object.entries(NS_FILE)) {
  const ttl = Deno.readTextFileSync(new URL(`../../../${file}`, import.meta.url));
  const quads = new Parser({ baseIRI: ns.slice(0, -1) }).parse(ttl);
  for (const q of quads) defined.add(q.subject.value);
}

/** Is this IRI in one of the four namespaces the app owns? */
const isOwned = (iri: string): boolean =>
  Object.keys(NS_FILE).some((ns) => iri.startsWith(ns));

Deno.test("every owned building-field predicate is defined in the vocab", () => {
  for (const f of BUILDING_FIELDS) {
    if (!isOwned(f.iri)) continue; // rec/schema.org/geo/vcard terms aren't ours
    assert.ok(defined.has(f.iri), `predicate not defined in vocab/: ${f.iri}`);
  }
});

Deno.test("every owned object-property range class is defined in the vocab", () => {
  for (const f of BUILDING_FIELDS) {
    if (f.range && isOwned(f.range)) {
      assert.ok(defined.has(f.range), `range class not defined in vocab/: ${f.range}`);
    }
  }
});

Deno.test("every controlled-vocab instance is defined in the investor vocab", () => {
  for (const localName of Object.keys(investorLocalNameLabels)) {
    const iri = `${INVESTOR_NS}${localName}`;
    assert.ok(defined.has(iri), `instance not defined in vocab/: ${iri}`);
  }
});

/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { Parser } from "n3";
import {
  BUILDING_FIELDS,
  investorLocalNameLabels,
} from "./building/buildingConfig.ts";
import { MEMBERSHIP_ROLE_TO_IRI } from "../../constants/roles.ts";
import {
  BENCH_COMPUTED_BY,
  BENCH_METRIC_PERIOD,
  BENCH_RESULT,
  BUILDING_NS,
  CONSUMPTION_NS,
  GRAN_NS,
} from "./vocabularies.ts";

/**
 * Drift guard: the repo's vocab/*.ttl files are the source of truth for the
 * Granergize vocabularies (see vocab/README.md). This asserts that every term the
 * app reads/writes — the building field-schema predicates, the controlled-vocab
 * object-property ranges and instances, the energy-dataset and view/benchmark
 * terms, and the core plumbing terms — is actually defined in the matching file.
 * Add a term in the code and this fails until it's defined, so the published
 * vocab can't silently desync from what the app writes.
 */

// Namespace IRI → vocab file (relative to repo root). Parsing each with its
// document IRI as base resolves `<#Foo>` to `<namespace>Foo`.
const NS_FILE: Record<string, string> = {
  [GRAN_NS]: "vocab/vocab.ttl",
  [BUILDING_NS]: "vocab/building.ttl",
  [CONSUMPTION_NS]: "vocab/consumption.ttl",
};

/** All subject IRIs defined across the owned vocab files. */
const defined: Set<string> = new Set();
for (const [ns, file] of Object.entries(NS_FILE)) {
  const ttl = Deno.readTextFileSync(new URL(`../../../${file}`, import.meta.url));
  const quads = new Parser({ baseIRI: ns.slice(0, -1) }).parse(ttl);
  for (const q of quads) defined.add(q.subject.value);
}

/** Is this IRI in one of the three namespaces the app owns? */
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

Deno.test("every controlled-vocab instance is defined in the building vocab", () => {
  for (const localName of Object.keys(investorLocalNameLabels)) {
    const iri = `${BUILDING_NS}${localName}`;
    assert.ok(defined.has(iri), `instance not defined in vocab/: ${iri}`);
  }
});

Deno.test("energy-dataset terms are defined in the consumption vocab", () => {
  const owned = [
    "EnergyDataset",
    "hasEnergyDataset",
    "ofBuilding",
    "datasetLocation",
    "granularity",
    "scenario",
    "Actual",
    "Planned",
    "ElectricityConsumption",
    "HeatConsumption",
    "WaterConsumption",
    "WastewaterConsumption",
    "RenewableSelfGeneratedShare",
    "EnergyConsumptionReading",
  ].map((n) => `${CONSUMPTION_NS}${n}`);
  for (const iri of owned) {
    assert.ok(defined.has(iri), `term not defined in vocab/: ${iri}`);
  }
});

Deno.test("benchmark + aggregated-view terms are defined in the consumption vocab", () => {
  // The view round-trip writes these owned terms onto definitions/snapshots
  // (BenchmarkResult is a cons:AggregatedViewSnapshot specialisation). Asserting
  // them keeps the published vocab in step with what the view/BSP flows emit.
  const owned = [
    BENCH_RESULT,
    BENCH_COMPUTED_BY,
    BENCH_METRIC_PERIOD,
    ...[
      "View",
      "AggregatedViewDefinition",
      "AggregatedViewSnapshot",
      "viewId",
      "viewName",
      "aggregationType",
      "viewPeriod",
      "createdAt",
      "lastComputedAt",
      "computedAt",
      "includesBuilding",
      "includesMetric",
      "buildingCount",
      "electricityValue",
      "electricityConsumptionValue",
      "heatConsumptionValue",
      "waterConsumptionValue",
      "wastewaterConsumptionValue",
      "renewableSelfGeneratedShareValue",
    ].map((n) => `${CONSUMPTION_NS}${n}`),
  ];
  for (const iri of owned) {
    assert.ok(defined.has(iri), `term not defined in vocab/: ${iri}`);
  }
});

Deno.test("core plumbing terms are defined in the core vocab", () => {
  const owned = [
    `${GRAN_NS}kind`,
    `${GRAN_NS}UserRole`,
    ...Object.values(MEMBERSHIP_ROLE_TO_IRI),
    `${GRAN_NS}Preferences`,
    `${GRAN_NS}currentRoom`,
    `${GRAN_NS}hiddenBuilding`,
    `${GRAN_NS}demoSeedDeclined`,
    `${GRAN_NS}Bookmarks`,
    `${GRAN_NS}knownRoom`,
  ];
  for (const iri of owned) {
    assert.ok(defined.has(iri), `term not defined in vocab/: ${iri}`);
  }
});

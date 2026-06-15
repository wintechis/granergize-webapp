/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { Parser } from "n3";
import { BUILDING_FIELDS } from "./building/buildingConfig.ts";
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
 * object-property ranges and instances, the energy-dataset and aggregation/benchmark
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

const RDFS_LABEL = "http://www.w3.org/2000/01/rdf-schema#label";

/** All subject IRIs defined across the owned vocab files. */
const defined: Set<string> = new Set();
/** Subject IRI → set of language tags it carries an rdfs:label in. */
const labelLangs: Map<string, Set<string>> = new Map();
for (const [ns, file] of Object.entries(NS_FILE)) {
  const ttl = Deno.readTextFileSync(new URL(`../../../${file}`, import.meta.url));
  const quads = new Parser({ baseIRI: ns.slice(0, -1) }).parse(ttl);
  for (const q of quads) {
    defined.add(q.subject.value);
    if (q.predicate.value === RDFS_LABEL && q.object.termType === "Literal") {
      const langs = labelLangs.get(q.subject.value) ?? new Set();
      langs.add(q.object.language);
      labelLangs.set(q.subject.value, langs);
    }
  }
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

/**
 * The controlled-vocabulary instances (BUILDING_NS local names) the code
 * references: the building-form `<Select>` options (shiftRegime / tenancyType /
 * indoorTemperatureClass — sourced from the vocab via `optionLabel`) plus the
 * operating-cost instances the parser materialises. Kept as an explicit list here
 * (no longer derived from a code-side label map) so the drift guard still pins
 * every instance the UI/parser can surface; each must be defined and fully
 * labelled in the vocab.
 */
const CONTROLLED_VOCAB_INSTANCES = [
  // shiftRegime / tenancyType / indoorTemperatureClass form options
  "OneShift",
  "TwoShift",
  "ThreeShift",
  "SingleTenant",
  "MultiTenant",
  "MaxTwelveDegrees",
  "MaxEighteenDegrees",
  // operating-cost instances (buildingParser pass 2)
  "Low",
  "Simple",
  "Medium",
  "High",
  "AllRisk",
  "FullServiceManagement",
];

Deno.test("every controlled-vocab instance is defined in the building vocab", () => {
  for (const localName of CONTROLLED_VOCAB_INSTANCES) {
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

Deno.test("benchmark + aggregation terms are defined in the consumption vocab", () => {
  // The aggregation round-trip writes these owned terms onto definitions/snapshots
  // (BenchmarkResult is a cons:AggregationSnapshot specialisation). Asserting
  // them keeps the published vocab in step with what the aggregation/BSP flows emit.
  const owned = [
    BENCH_RESULT,
    BENCH_COMPUTED_BY,
    BENCH_METRIC_PERIOD,
    ...[
      "Aggregation",
      "AggregationDefinition",
      "AggregationSnapshot",
      "aggregationId",
      "aggregationName",
      "aggregationType",
      "aggregationPeriod",
      "createdAt",
      "lastComputedAt",
      "computedAt",
      "includesBuilding",
      "includesMetric",
      "buildingCount",
      // Snapshot values collapsed into sosa:ObservationCollection members (no
      // per-metric `*Value` properties); the observed properties are the
      // :…Consumption / :…Generation / :…Share terms asserted above.
    ].map((n) => `${CONSUMPTION_NS}${n}`),
  ];
  for (const iri of owned) {
    assert.ok(defined.has(iri), `term not defined in vocab/: ${iri}`);
  }
});

/**
 * Every owned term the code references (so the UI can surface its label): the
 * building-field predicates and their controlled-vocab ranges + instances, the
 * membership-role IRIs, and the energy/aggregation/core terms asserted above. The
 * label-completeness guard runs over THIS set — a code-referenced term that
 * carries no label at all (not just an incomplete translation) is a failure.
 */
const CODE_REFERENCED_OWNED: string[] = [
  ...BUILDING_FIELDS.flatMap((f) => [f.iri, f.range]).filter(
    (iri): iri is string => !!iri && isOwned(iri),
  ),
  ...CONTROLLED_VOCAB_INSTANCES.map((n) => `${BUILDING_NS}${n}`),
  ...Object.values(MEMBERSHIP_ROLE_TO_IRI),
];

Deno.test("every code-referenced owned term carries en + de rdfs:labels", () => {
  // The app is multilingual (de/en/fr — see notes/explore-presentation-profile.md
  // § Multilingual rendering). English + German are the shipped baseline and must
  // be complete: a code-referenced owned term missing either fails the build
  // rather than silently falling back to the IRI fragment at render time.
  const missingFr: string[] = [];
  for (const iri of CODE_REFERENCED_OWNED) {
    const langs = labelLangs.get(iri) ?? new Set<string>();
    for (const lang of ["en", "de"]) {
      assert.ok(langs.has(lang), `term missing @${lang} rdfs:label in vocab/: ${iri}`);
    }
    // French is the third target but a KNOWN pending authoring gap: log the
    // missing translations, don't fail (see the plan's sequencing). Promote to an
    // assertion once the @fr labels land in the vocab.
    if (!langs.has("fr")) missingFr.push(iri);
  }
  if (missingFr.length > 0) {
    console.warn(
      `[vocab] ${missingFr.length} code-referenced owned term(s) missing @fr rdfs:label (known pending gap):\n  ` +
        missingFr.join("\n  "),
    );
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

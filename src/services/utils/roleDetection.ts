import { DataFactory, Store } from "n3";
import type { UserRole } from "../../../types/types.ts";
import {
  BENCH_NS,
  INVESTOR_NS,
  RDF_TYPE,
  SOSA_NS,
  USERVOC_NS,
} from "./vocabularies.ts";

const { namedNode } = DataFactory;

/**
 * Lightweight, n3-based role detection that mirrors the signatures formalised in
 * `roles.shex`. It is NOT a full ShEx validator — the ShEx JS engines do not run
 * under Deno (see ROLES.md) — but it encodes the same discriminators so it can
 * be tested with the existing offline-fixture harness and used to implement the
 * recommended "validate + infer-on-missing" flow.
 *
 * The declared `gran:dataSourceRole` annotation remains authoritative; this is
 * the fallback/validation path, not a replacement for it.
 */

function hasPredicateInNamespace(store: Store, ns: string): boolean {
  for (const q of store.getQuads(null, null, null, null)) {
    if (q.predicate.value.startsWith(ns)) return true;
  }
  return false;
}

function hasTypedNode(store: Store, typeIri: string): boolean {
  return store.getQuads(null, namedNode(RDF_TYPE), namedNode(typeIri), null)
    .length > 0;
}

export interface BuildingRoleResult {
  /** Best-guess role from the building graph alone. */
  role: UserRole;
  /**
   * False when the building shape cannot settle the role. Today this happens for
   * dummy vs. user: both are core + gran:hasEnergyConsumptionDataset and are
   * indistinguishable without the referenced energy file. Callers should consult
   * the energy graph (detectEnergyShape) or the declared annotation.
   */
  certain: boolean;
}

/**
 * Detect the role from a single building's graph (the building file).
 *
 * Most-specific-wins: investor and benchmark carry namespace-specific
 * predicates and win outright; otherwise the shape is the shared dummy/user
 * core, reported as `dummy` with `certain: false`.
 */
export function detectBuildingRole(store: Store): BuildingRoleResult {
  if (hasPredicateInNamespace(store, INVESTOR_NS)) {
    return { role: "investor", certain: true };
  }
  if (hasPredicateInNamespace(store, BENCH_NS)) {
    return { role: "benchmark_service_provider", certain: true };
  }
  // dummy and user share the core building shape — cannot be told apart here.
  return { role: "dummy", certain: false };
}

export type EnergyShape =
  | "user-readings" // uservoc:EnergyConsumptionReading  (15-min time series)
  | "categorical-observations" // sosa:Observation (dummy/benchmark/investor)
  | "unknown";

/**
 * Whether a dataset's declared `gran:granularity` (xsd:duration) is a sub-hourly
 * *series* — large, fetched lazily on demand — vs. an *aggregate* (monthly/annual)
 * that's small enough to bulk-load. Drives the load strategy independently of the
 * producer's role. Sub-hourly = a time-only ISO-8601 duration with minutes/hours
 * (`PT…M` / `PT…H`); anything with a date part (`P…Y/M/W/D`) is an aggregate.
 * Returns false for absent/unparseable values (treat as aggregate — bulk-load).
 */
export function isSeriesGranularity(granularity?: string): boolean {
  if (!granularity) return false;
  const m = /^PT(?:\d+H)?(?:(\d+)M)?/.exec(granularity);
  if (!granularity.startsWith("PT")) return false; // has a date part ⇒ aggregate
  // PT-prefixed (time-only) durations are sub-hourly series (minutes/hours).
  return m !== null;
}

/**
 * Detect the shape of an energy file. This is what actually separates user from
 * dummy/benchmark, since their building files are identical.
 */
export function detectEnergyShape(store: Store): EnergyShape {
  if (hasTypedNode(store, `${USERVOC_NS}EnergyConsumptionReading`)) {
    return "user-readings";
  }
  if (hasTypedNode(store, `${SOSA_NS}Observation`)) {
    return "categorical-observations";
  }
  return "unknown";
}

/**
 * Resolve a role using the building graph and, when the building graph is
 * inconclusive (dummy vs. user), the referenced energy graph. Mirrors the
 * decision logic described in ROLES.md.
 *
 * @param buildingStore parsed building file
 * @param energyStore   parsed energy file referenced by the building, if available
 */
export function resolveRole(
  buildingStore: Store,
  energyStore?: Store,
): BuildingRoleResult {
  const fromBuilding = detectBuildingRole(buildingStore);
  if (fromBuilding.certain) return fromBuilding;

  if (energyStore) {
    const shape = detectEnergyShape(energyStore);
    if (shape === "user-readings") return { role: "user", certain: true };
    if (shape === "categorical-observations") {
      return { role: "dummy", certain: true };
    }
  }

  // Still ambiguous: fall back to dummy, but flag it so callers can prefer the
  // declared annotation instead of trusting this guess.
  return { role: "dummy", certain: false };
}

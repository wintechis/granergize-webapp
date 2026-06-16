/**
 * The **EntityQuery** seam — a React-free resolver turning an entity IRI into the
 * typed instance the intent layer's `applies()` guards consume.
 *
 * See [`../../explore/explore-intent-registry.md`](../../explore/explore-intent-registry.md)
 * §"Entity queries": Apple pairs every entity with a by-identity resolver
 * (identifier → instance) the system calls while *binding* an intent's parameters,
 * below any view machinery. The app fills that role only implicitly — a route's
 * `:id` is resolved by filtering the already-loaded collection folds in memory;
 * there is no named "resolve building by IRI" read. This module reifies it: a
 * one-shot, below-React call from a bare IRI, so the callable layer
 * ({@link applicableIntents}/`invokeByName`) can bind and state-filter verbs
 * **without a component tree** (headless callers, tools, deep links).
 *
 * It is the binding/filtering seam, NOT a new loader: it **reuses the app's own
 * single-resource reads + parsers**:
 * - building → {@link fetchFresh} the building document + {@link parseBuildings}
 *   (the one building parser), with `isShared` set exactly as
 *   {@link loadBuildings} does (own vs shared = whether the source lives under the
 *   viewer's storage root).
 * - aggregation → {@link getAggregationDefinition} (the existing single-definition
 *   read), addressed by the IRI's file stem (the `aggregationId`).
 *
 * It resolves **only enough to satisfy the `applies()` guards** (own-vs-shared,
 * has-energy, has-attachment, snapshot-exists) — both reuse paths already populate
 * those facts, so no extra fetch is needed.
 */
import type { Session } from "@inrupt/solid-client-authn-browser";
import { Parser } from "n3";
import type { Quad } from "@rdfjs/types";
import type { BuildingType } from "../types.ts";
import type { IntentEntity } from "./catalog.ts";
import {
  applicableIntents,
  type IntentEntry,
  type IntentObject,
  type ViewerContext,
} from "./applicable.ts";
import { parseBuildings } from "../services/rdf/building/buildingParser.ts";
import { buildingFileUri } from "../services/rdf/building/buildingId.ts";
import { fetchFresh } from "../services/pod/podFetch.ts";
import { getStorageRoot } from "../services/pod/solidUtils.ts";
import { getAggregationDefinition } from "../services/aggregation/aggregationManager.ts";

/**
 * Resolve a building IRI (its subject IRI `…/b.ttl#it`, or the bare document IRI)
 * to a {@link BuildingType}, reusing {@link parseBuildings} on the single fetched
 * document. `isShared` is set the way {@link loadBuildings} does it: the building
 * is shared-with-the-viewer iff its source document does not live under the
 * viewer's own storage root. A single source needs no blank-node scoping (that
 * guards only against ID collisions when merging several documents), so this is
 * the minimal compose of the existing fetch + parser.
 */
async function resolveBuilding(
  iri: string,
  session: Session,
): Promise<IntentObject | undefined> {
  const fileUri = buildingFileUri(iri);
  const res = await fetchFresh(fileUri, session);
  if (!res.ok) return undefined;

  const quads: Quad[] = new Parser({ baseIRI: fileUri }).parse(await res.text());

  // The viewer's storage root decides own-vs-shared (and shortens the id to its
  // storage-relative form for own buildings — the same call `loadBuildings` makes).
  const webId = session.info.webId;
  let storageRoot: string | undefined;
  if (webId) {
    try {
      storageRoot = getStorageRoot(webId);
    } catch {
      storageRoot = undefined; // root not resolved → treat ids as absolute
    }
  }

  const buildings = parseBuildings(quads, storageRoot);
  // Pick the building whose subject IRI matches the requested IRI; fall back to
  // the sole building when the caller passed the document IRI (no fragment).
  let match: BuildingType | undefined;
  for (const building of buildings.values()) {
    if (building.uri === iri) {
      match = building;
      break;
    }
  }
  if (!match && buildings.size === 1) {
    match = buildings.values().next().value;
  }
  if (!match) return undefined;

  // Ownership = whether the source file lives under the viewer's storage root
  // (mirrors `loadBuildings`). With no resolved root we cannot claim ownership,
  // so the building is treated as not-own (shared) — the conservative default for
  // owner-only affordance guards.
  const source = match.sourceUri || match.uri;
  match.isShared = storageRoot ? !source.startsWith(storageRoot) : true;
  return match;
}

/**
 * Resolve an aggregation IRI to an {@link AggregationDefinition}, reusing
 * {@link getAggregationDefinition} (the existing single-definition read). That
 * function is keyed by `aggregationId` and rebuilds the resource path under the
 * viewer's WebID — which is exactly right: aggregation *definitions* are own-only
 * (only their computed snapshots are shared), and the IRI's file stem IS the id
 * (`aggregations/<id>.ttl`).
 */
async function resolveAggregation(
  iri: string,
  session: Session,
): Promise<IntentObject | undefined> {
  const fileUri = buildingFileUri(iri); // strip any fragment
  const stem = fileUri.split("/").filter(Boolean).pop() ?? "";
  const aggregationId = stem.replace(/\.ttl$/, "");
  if (!aggregationId) return undefined;
  const def = await getAggregationDefinition(session, aggregationId);
  return def ?? undefined;
}

/**
 * Resolve an entity IRI to the typed instance the `applies()` guards consume.
 * Returns `undefined` for an unresolvable resource or an unsupported entity (only
 * `building` and `aggregation` carry per-object affordance guards today; the rest
 * resolve to `undefined`).
 */
export function resolve(
  entity: IntentEntity,
  iri: string,
  session: Session,
): Promise<IntentObject | undefined> {
  switch (entity) {
    case "building":
      return resolveBuilding(iri, session);
    case "aggregation":
      return resolveAggregation(iri, session);
    default:
      return Promise.resolve(undefined);
  }
}

/**
 * Convenience: resolve an entity IRI, then return the state-filtered verb set
 * ({@link applicableIntents}) — so a caller holding only an IRI (a deep link, a
 * palette, an LLM tool) gets exactly the verbs the object affords the viewer,
 * without a component tree. An unresolvable IRI yields `[]` (the viewer affords no
 * verb on a thing that does not resolve).
 */
export async function applicableForIri(
  entity: IntentEntity,
  iri: string,
  viewer: ViewerContext,
  session: Session,
): Promise<IntentEntry[]> {
  const object = await resolve(entity, iri, session);
  if (object === undefined) return [];
  return applicableIntents(object, viewer);
}

import type { PodGateway } from "../pod/podGateway.ts";
import { DataFactory, Parser, Store, type Term, Writer } from "n3";
import { podResources } from "../pod/solidUtils.ts";
import type {
  AggregationDefinition,
  AggregationSnapshot,
  SpatialExtent,
} from "../../types.ts";
import {
  BENCH_COMPUTED_BY,
  BENCH_METRIC_PERIOD,
  BENCH_RESULT,
  CONSUMPTION_NS,
  RDF_NS,
  RDF_TYPE,
  SOSA_NS,
  SSN_NS,
  XSD_BOOLEAN,
  XSD_DATETIME,
  XSD_DECIMAL,
  XSD_GYEAR,
  XSD_INTEGER,
  XSD_NS,
} from "../rdf/vocabularies.ts";
import { ENERGY_METRICS } from "../rdf/energyDataset.ts";
import { getQuadValue, getQuadValues } from "../rdf/rdfHelpers.ts";
import { fetchFresh, readStoreOrEmpty } from "../pod/podFetch.ts";
import { ensureContainer, readModifyWrite } from "../pod/podWrite.ts";
import { listDirectChildren } from "../pod/podDelete.ts";
import { mapPooled } from "../../lib/pool.ts";
import { logError } from "../../lib/logError.ts";

const { namedNode, literal, quad, blankNode } = DataFactory;

const VOCAB_PREFIX = CONSUMPTION_NS;

const SPATIAL_EXTENT = `${VOCAB_PREFIX}spatialExtent`;
const EXTENT_LEVEL = `${VOCAB_PREFIX}extentLevel`;

/** Write an aggregation's spatial coordinate (region node + level) onto `node`. */
function addSpatialExtent(
  store: Store,
  node: ReturnType<typeof namedNode>,
  extent: SpatialExtent,
): void {
  store.addQuad(quad(node, namedNode(SPATIAL_EXTENT), namedNode(extent.region)));
  store.addQuad(quad(node, namedNode(EXTENT_LEVEL), literal(extent.level)));
}

/** Read an aggregation's spatial coordinate back (a spreadable patch — `{}` when none was
 *  recorded, mirroring the benchmark-field reads). */
function readSpatialExtent(
  store: Store,
  node: Term,
): { spatialExtent: SpatialExtent } | Record<never, never> {
  const region = getQuadValue(store, node, namedNode(SPATIAL_EXTENT));
  if (!region) return {};
  return {
    spatialExtent: {
      region,
      level: getQuadValue(store, node, namedNode(EXTENT_LEVEL)) ?? "",
    },
  };
}

/**
 * Standard prefixes for Turtle serialization
 */
const TTL_PREFIXES = `@prefix rdf: <${RDF_NS}> .
@prefix xsd: <${XSD_NS}> .
@prefix cons: <${VOCAB_PREFIX}> .

`;

/**
 * Serialize quads to Turtle with prefixes
 */
function serializeWithPrefixes(store: Store): string {
  const writer = new Writer({ format: "text/turtle" });
  return TTL_PREFIXES +
    writer.quadsToString(store.getQuads(null, null, null, null));
}

/** The `aggregations/` container — one definition resource per aggregation (discover by listing). */
function aggregationsContainerUri(webId: string): string {
  return podResources(webId).aggregations;
}

/** The `aggregations/snapshots/` container — one shareable computed copy per aggregation. */
function snapshotsContainerUri(webId: string): string {
  return `${aggregationsContainerUri(webId)}snapshots/`;
}

/** A single aggregation definition resource: `aggregations/<aggregationId>.ttl`. */
function getAggregationDefinitionUri(webId: string, aggregationId: string): string {
  return `${aggregationsContainerUri(webId)}${aggregationId}.ttl`;
}

/** A single computed snapshot resource: `aggregations/snapshots/<aggregationId>.ttl`. */
function getComputedSnapshotUri(webId: string, aggregationId: string): string {
  return `${snapshotsContainerUri(webId)}${aggregationId}.ttl`;
}

/** The definition's subject node (a fragment of its own resource). */
function aggregationNodeFor(webId: string, aggregationId: string) {
  return namedNode(`${getAggregationDefinitionUri(webId, aggregationId)}#aggregation`);
}

/** Ensure the `aggregations/` and `aggregations/snapshots/` containers exist (parent first).
 * A creation failure propagates here, instead of resurfacing later as a
 * confusing aggregation-PUT failure. */
async function ensureAggregationsDirectoryExists(gateway: PodGateway): Promise<void> {
  const webId = gateway.webId;
  if (!webId) {
    throw new Error("User is not logged in");
  }

  await ensureContainer(aggregationsContainerUri(webId), gateway);
  await ensureContainer(snapshotsContainerUri(webId), gateway);
}

/**
 * Generate a unique aggregation ID — collision-free via crypto.randomUUID (the same
 * fix as building file ids; a timestamp+short-random id could collide in a
 * tight loop).
 */
function generateAggregationId(): string {
  return `aggregation-${crypto.randomUUID()}`;
}

/**
 * Create a new aggregation definition
 * @operation mutation
 */
export async function createAggregationDefinition(
  gateway: PodGateway,
  name: string,
  buildingUris: string[],
  aggregationType: AggregationDefinition["aggregationType"],
  metrics: string[],
  opts: { period?: string; benchmark?: boolean; spatialExtent?: SpatialExtent } = {},
): Promise<AggregationDefinition> {
  const { period, benchmark, spatialExtent } = opts;
  if (!gateway.webId) {
    throw new Error("User is not logged in");
  }

  await ensureAggregationsDirectoryExists(gateway);

  const aggregationId = generateAggregationId();
  const now = new Date().toISOString();
  const webId = gateway.webId;
  const definitionUri = getAggregationDefinitionUri(webId, aggregationId);

  const newAggregation: AggregationDefinition = {
    id: aggregationId,
    name,
    buildingUris,
    aggregationType,
    metrics,
    createdAt: now,
    ...(period ? { period } : {}),
    ...(benchmark ? { benchmark } : {}),
    ...(spatialExtent ? { spatialExtent } : {}),
  };

  const aggregationNode = aggregationNodeFor(webId, aggregationId);

  // One resource per aggregation (opaque id ⇒ collision-free), so a plain PUT suffices —
  // no shared mega-file to clobber.
  const store = new Store();
  store.addQuad(quad(
    aggregationNode,
    namedNode(RDF_TYPE),
    namedNode(`${VOCAB_PREFIX}AggregationDefinition`),
  ));
  store.addQuad(quad(aggregationNode, namedNode(`${VOCAB_PREFIX}aggregationId`), literal(aggregationId)));
  store.addQuad(quad(aggregationNode, namedNode(`${VOCAB_PREFIX}aggregationName`), literal(name)));
  store.addQuad(quad(
    aggregationNode,
    namedNode(`${VOCAB_PREFIX}aggregationType`),
    literal(aggregationType),
  ));
  store.addQuad(quad(
    aggregationNode,
    namedNode(`${VOCAB_PREFIX}createdAt`),
    literal(now, namedNode(XSD_DATETIME)),
  ));
  if (period) {
    store.addQuad(quad(
      aggregationNode,
      namedNode(`${VOCAB_PREFIX}aggregationPeriod`),
      literal(period),
    ));
  }
  // The benchmark flag is PERSISTED on the definition (ground truth), so every
  // (re)compute — including a plain "Refresh Snapshot" — re-derives the
  // snapshot's bench:BenchmarkResult typing from it instead of relying on
  // call-site options that a refresh wouldn't know to pass.
  if (benchmark) {
    store.addQuad(quad(
      aggregationNode,
      namedNode(`${VOCAB_PREFIX}benchmark`),
      literal("true", namedNode(XSD_BOOLEAN)),
    ));
  }
  // Building URIs (private, only in the definition file).
  for (const buildingUri of buildingUris) {
    store.addQuad(quad(
      aggregationNode,
      namedNode(`${VOCAB_PREFIX}includesBuilding`),
      namedNode(buildingUri),
    ));
  }
  for (const metric of metrics) {
    store.addQuad(quad(
      aggregationNode,
      namedNode(`${VOCAB_PREFIX}includesMetric`),
      literal(metric),
    ));
  }
  // The region coordinate (when the member set rolls up to one) — distinct from the
  // private includesBuilding set; the load-bearing axis for the map/timeline guises.
  if (spatialExtent) addSpatialExtent(store, aggregationNode, spatialExtent);

  const res = await gateway.fetch(definitionUri, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: serializeWithPrefixes(store),
  });
  if (!res.ok) {
    throw new Error(`Failed to create aggregation definition: ${res.statusText}`);
  }

  return newAggregation;
}

/** Extract an {@link AggregationDefinition} from a parsed definition store. */
function parseAggregationDefinition(store: Store): AggregationDefinition | null {
  const aggregationType_ = namedNode(`${VOCAB_PREFIX}AggregationDefinition`);
  const aggregationNode = store.getQuads(null, namedNode(RDF_TYPE), aggregationType_, null)[0]
    ?.subject;
  if (!aggregationNode) return null;
  return {
    id: getQuadValue(store, aggregationNode, namedNode(`${VOCAB_PREFIX}aggregationId`)) ?? "",
    name: getQuadValue(store, aggregationNode, namedNode(`${VOCAB_PREFIX}aggregationName`)) ??
      "",
    aggregationType: (getQuadValue(
      store,
      aggregationNode,
      namedNode(`${VOCAB_PREFIX}aggregationType`),
    ) ?? "average") as AggregationDefinition["aggregationType"],
    createdAt:
      getQuadValue(store, aggregationNode, namedNode(`${VOCAB_PREFIX}createdAt`)) ?? "",
    lastComputedAt: getQuadValue(
      store,
      aggregationNode,
      namedNode(`${VOCAB_PREFIX}lastComputedAt`),
    ),
    buildingUris: getQuadValues(
      store,
      aggregationNode,
      namedNode(`${VOCAB_PREFIX}includesBuilding`),
    ),
    metrics: getQuadValues(
      store,
      aggregationNode,
      namedNode(`${VOCAB_PREFIX}includesMetric`),
    ),
    period: getQuadValue(store, aggregationNode, namedNode(`${VOCAB_PREFIX}aggregationPeriod`)),
    ...(getQuadValue(store, aggregationNode, namedNode(`${VOCAB_PREFIX}benchmark`)) ===
        "true"
      ? { benchmark: true }
      : {}),
    ...readSpatialExtent(store, aggregationNode),
  };
}

/**
 * All aggregation definitions for the current user, discovered by LISTING the `aggregations/`
 * container (the top-level `*.ttl` resources; the `snapshots/` subfolder is
 * skipped) and parsing each. A missing container (fresh Pod) yields `[]`.
 * @operation query
 */
export async function getAggregationDefinitions(
  gateway: PodGateway,
): Promise<AggregationDefinition[]> {
  const webId = gateway.webId;
  if (!webId) {
    throw new Error("User is not logged in");
  }

  // No try/catch: a real network/parse failure propagates to React Query (which
  // keeps the last good aggregations via keepPreviousData). The legitimate empty — the
  // container doesn't exist yet — is the explicit `if (!children) return []` below,
  // so it stays distinct from "the read failed".
  const children = await listDirectChildren(aggregationsContainerUri(webId), gateway);
  if (!children) return []; // container doesn't exist yet
  const defUris = children.filter((u) => u.endsWith(".ttl"));

  // Bounded concurrency: a burst of GETs trips Cloudflare's rate limiter.
  const aggregations = await mapPooled(
    defUris,
    4,
    async (url) => parseAggregationDefinition(await readStoreOrEmpty(url, gateway)),
  );
  return aggregations.filter((v): v is AggregationDefinition => v !== null);
}

/**
 * A single aggregation definition by ID — a direct read of `aggregations/<aggregationId>.ttl` (no
 * need to list the whole container).
 * @operation query
 */
export async function getAggregationDefinition(
  gateway: PodGateway,
  aggregationId: string,
): Promise<AggregationDefinition | null> {
  const webId = gateway.webId;
  if (!webId) return null;
  try {
    const store = await readStoreOrEmpty(
      getAggregationDefinitionUri(webId, aggregationId),
      gateway,
    );
    return parseAggregationDefinition(store);
  } catch (error) {
    console.error("Error getting aggregation definition:", error);
    return null;
  }
}

/**
 * Store a computed snapshot for an aggregation
 * @operation mutation
 */
/**
 * A snapshot metric key → its `sosa:observedProperty` + unit, for collapsing the
 * value into a member observation. Most keys are annual energy metrics
 * ({@link ENERGY_METRICS}); the sub-hourly series aggregation path mints a bare
 * `electricity` key with no own entry, so alias it to electricity consumption.
 */
function metricInfo(metric: string): { prop: string; unit: string } | undefined {
  return ENERGY_METRICS[metric as keyof typeof ENERGY_METRICS] ??
    (metric === "electricity" ? ENERGY_METRICS.electricityConsumption : undefined);
}

export async function storeComputedSnapshot(
  gateway: PodGateway,
  snapshot: AggregationSnapshot,
): Promise<string> {
  if (!gateway.webId) {
    throw new Error("User is not logged in");
  }

  await ensureAggregationsDirectoryExists(gateway);

  const snapshotUri = getComputedSnapshotUri(gateway.webId, snapshot.id);
  const snapshotNode = namedNode(`${snapshotUri}#snapshot`);

  const store = new Store();

  // Add snapshot metadata
  store.addQuad(quad(
    snapshotNode,
    namedNode(RDF_TYPE),
    namedNode(`${VOCAB_PREFIX}AggregationSnapshot`),
  ));

  store.addQuad(quad(
    snapshotNode,
    namedNode(`${VOCAB_PREFIX}aggregationId`),
    literal(snapshot.id),
  ));

  store.addQuad(quad(
    snapshotNode,
    namedNode(`${VOCAB_PREFIX}aggregationName`),
    literal(snapshot.name),
  ));

  store.addQuad(quad(
    snapshotNode,
    namedNode(`${VOCAB_PREFIX}aggregationType`),
    literal(snapshot.aggregationType),
  ));

  store.addQuad(quad(
    snapshotNode,
    namedNode(`${VOCAB_PREFIX}computedAt`),
    literal(snapshot.computedAt, namedNode(XSD_DATETIME)),
  ));

  store.addQuad(quad(
    snapshotNode,
    namedNode(`${VOCAB_PREFIX}buildingCount`),
    literal(snapshot.buildingCount.toString(), namedNode(XSD_INTEGER)),
  ));

  // Benchmark result: the snapshot is additionally a bench:BenchmarkResult and
  // records who computed it and which year it covers. It stays a
  // gra:AggregationSnapshot too, so every existing reader keeps working.
  if (snapshot.isBenchmark) {
    store.addQuad(quad(
      snapshotNode,
      namedNode(RDF_TYPE),
      namedNode(BENCH_RESULT),
    ));
    if (snapshot.computedBy) {
      store.addQuad(quad(
        snapshotNode,
        namedNode(BENCH_COMPUTED_BY),
        namedNode(snapshot.computedBy),
      ));
    }
    if (snapshot.metricPeriod) {
      store.addQuad(quad(
        snapshotNode,
        namedNode(BENCH_METRIC_PERIOD),
        literal(snapshot.metricPeriod, namedNode(XSD_GYEAR)),
      ));
    }
  }

  // The region coordinate, recorded IN the snapshot so a shared copy stays self-sufficient
  // (the recipient reads it without re-deriving from the private member set).
  if (snapshot.spatialExtent) addSpatialExtent(store, snapshotNode, snapshot.spatialExtent);

  // Add metrics
  for (const metric of snapshot.metrics) {
    store.addQuad(quad(
      snapshotNode,
      namedNode(`${VOCAB_PREFIX}includesMetric`),
      literal(metric),
    ));
  }

  // Computed values, COLLAPSED into a sosa:ObservationCollection — each metric is
  // a member sosa:Observation, the same shape an energy dataset uses (see
  // energyDataset.ts), so one renderer can serve energy + aggregation + benchmark.
  // The node stays a cons:AggregationSnapshot (marker, above) AND is now an
  // observation-collection. Full precision — rounding lost real precision
  // (share-% metrics, 15-min sums); display formatting is the UI's job. `e`-form
  // floats are expanded via toFixed (invalid lexical xsd:decimal otherwise).
  store.addQuad(quad(
    snapshotNode,
    namedNode(RDF_TYPE),
    namedNode(`${SOSA_NS}ObservationCollection`),
  ));
  for (const [metric, value] of Object.entries(snapshot.values)) {
    const m = metricInfo(metric);
    if (!m) continue; // only known energy metrics carry an observedProperty + unit
    const lexical = Number.isInteger(value)
      ? String(value)
      : String(value).includes("e")
      ? value.toFixed(10)
      : String(value);
    const obs = blankNode();
    const result = blankNode();
    store.addQuad(quad(snapshotNode, namedNode(`${SOSA_NS}hasMember`), obs));
    store.addQuad(quad(obs, namedNode(RDF_TYPE), namedNode(`${SOSA_NS}Observation`)));
    store.addQuad(quad(obs, namedNode(`${SOSA_NS}observedProperty`), namedNode(m.prop)));
    store.addQuad(quad(obs, namedNode(`${SOSA_NS}hasResult`), result));
    store.addQuad(quad(
      result,
      namedNode(`${SOSA_NS}hasSimpleResult`),
      literal(lexical, namedNode(XSD_DECIMAL)),
    ));
    store.addQuad(quad(result, namedNode(`${SSN_NS}hasUnit`), namedNode(m.unit)));
  }

  // Serialize and save
  const ttl = serializeWithPrefixes(store);

  const putResponse = await gateway.fetch(snapshotUri, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: ttl,
  });

  if (!putResponse.ok) {
    throw new Error(
      `Failed to save computed snapshot: ${putResponse.statusText}`,
    );
  }

  // Update lastComputedAt in the definition
  await updateAggregationLastComputed(gateway, snapshot.id, snapshot.computedAt);

  return snapshotUri;
}

/**
 * Update the lastComputedAt timestamp in an aggregation definition
 */
async function updateAggregationLastComputed(
  gateway: PodGateway,
  aggregationId: string,
  timestamp: string,
): Promise<void> {
  const webId = gateway.webId;
  if (!webId) return;

  const definitionUri = getAggregationDefinitionUri(webId, aggregationId);
  const aggregationNode = aggregationNodeFor(webId, aggregationId);
  const lastComputedPred = namedNode(`${VOCAB_PREFIX}lastComputedAt`);

  await readModifyWrite(definitionUri, gateway, (store, { created }) => {
    if (created) return false; // no definition file → nothing to update
    store.getQuads(aggregationNode, lastComputedPred, null, null)
      .forEach((q) => store.removeQuad(q));
    store.addQuad(quad(
      aggregationNode,
      lastComputedPred,
      literal(timestamp, namedNode(XSD_DATETIME)),
    ));
  }, { serialize: serializeWithPrefixes });
}

/**
 * Load a computed snapshot from URL.
 *
 * Distinguishes ABSENCE from FAILURE: `null` means the snapshot genuinely does
 * not exist (404/410, or the document isn't a snapshot) — the signal the aggregation
 * page's auto-compute keys on. Any transient failure (throttling, network,
 * unparseable response) THROWS instead: returning `null` there once made a
 * failed read of an EXISTING snapshot trigger a snapshot-overwriting recompute.
 * Callers that want per-item tolerance (e.g. folding received benchmarks)
 * catch per snapshot.
 * @operation query
 */
export async function loadComputedSnapshot(
  gateway: PodGateway,
  snapshotUri: string,
): Promise<AggregationSnapshot | null> {
  const response = await fetchFresh(snapshotUri, gateway);
  // 404/410 = deleted, 403 = the owner revoked your access — all mean "gone",
  // a normal lifecycle event for a resource shared WITH you, not a failure.
  if (
    response.status === 404 || response.status === 410 ||
    response.status === 403
  ) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Failed to load snapshot (HTTP ${response.status}): ${snapshotUri}`,
    );
  }

  const text = await response.text();
  const parser = new Parser({ format: "text/turtle", baseIRI: snapshotUri });
  const quads = parser.parse(text);
  const store = new Store(quads);

  const snapshotType = namedNode(`${VOCAB_PREFIX}AggregationSnapshot`);
  const snapshotQuads = store.getQuads(
    null,
    namedNode(RDF_TYPE),
    snapshotType,
    null,
  );

  if (snapshotQuads.length === 0) {
    return null;
  }

  const snapshotNode = snapshotQuads[0].subject;

  const isBenchmark = store.getQuads(
    snapshotNode,
    namedNode(RDF_TYPE),
    namedNode(BENCH_RESULT),
    null,
  ).length > 0;
  const computedBy = getQuadValue(
    store,
    snapshotNode,
    namedNode(BENCH_COMPUTED_BY),
  );
  const metricPeriod = getQuadValue(
    store,
    snapshotNode,
    namedNode(BENCH_METRIC_PERIOD),
  );

  const metrics = getQuadValues(
    store,
    snapshotNode,
    namedNode(`${VOCAB_PREFIX}includesMetric`),
  );
  // Values are now sosa:ObservationCollection members (collapsed shape). Read each
  // member observation's value keyed by its observedProperty IRI, then map back to
  // the EXACT metric keys from `includesMetric` (driving by those keys keeps the
  // round-trip lossless — the series path's bare `electricity` and the annual
  // `electricityConsumption` share one observedProperty, so a prop→key reverse
  // would be ambiguous; `metricInfo` resolves each key's prop instead).
  const valueByProp: Record<string, number> = {};
  for (
    const memberQ of store.getQuads(
      snapshotNode,
      namedNode(`${SOSA_NS}hasMember`),
      null,
      null,
    )
  ) {
    const obs = memberQ.object;
    const propQ = store.getQuads(
      obs,
      namedNode(`${SOSA_NS}observedProperty`),
      null,
      null,
    )[0];
    const resultQ = store.getQuads(
      obs,
      namedNode(`${SOSA_NS}hasResult`),
      null,
      null,
    )[0];
    if (!propQ || !resultQ) continue;
    const simpleQ = store.getQuads(
      resultQ.object,
      namedNode(`${SOSA_NS}hasSimpleResult`),
      null,
      null,
    )[0];
    if (simpleQ) valueByProp[propQ.object.value] = parseFloat(simpleQ.object.value);
  }
  const values: Record<string, number> = {};
  for (const metric of metrics) {
    const m = metricInfo(metric);
    if (m && valueByProp[m.prop] !== undefined) values[metric] = valueByProp[m.prop];
  }

  return {
    id: getQuadValue(store, snapshotNode, namedNode(`${VOCAB_PREFIX}aggregationId`)) ??
      "",
    name: getQuadValue(
      store,
      snapshotNode,
      namedNode(`${VOCAB_PREFIX}aggregationName`),
    ) ?? "",
    aggregationType: (getQuadValue(
      store,
      snapshotNode,
      namedNode(`${VOCAB_PREFIX}aggregationType`),
    ) ?? "average") as AggregationSnapshot["aggregationType"],
    computedAt: getQuadValue(
      store,
      snapshotNode,
      namedNode(`${VOCAB_PREFIX}computedAt`),
    ) ?? "",
    buildingCount: parseInt(
      getQuadValue(
        store,
        snapshotNode,
        namedNode(`${VOCAB_PREFIX}buildingCount`),
      ) ?? "0",
      10,
    ),
    metrics,
    values,
    ...(isBenchmark ? { isBenchmark } : {}),
    ...(computedBy ? { computedBy } : {}),
    ...(metricPeriod ? { metricPeriod } : {}),
    ...readSpatialExtent(store, snapshotNode),
  };
}

/**
 * Load the given received aggregations' snapshots and keep the ones marked as a
 * benchmark result — what the energy aggregation compares the owner's own figures
 * against. Takes the already-derived received aggregations (from the folded
 * `shared-in/` log) so it performs no fold of its own; unreadable or
 * non-benchmark snapshots are dropped.
 * @operation query
 */
export async function getReceivedBenchmarksFor(
  gateway: PodGateway,
  // Structural shape (only the snapshot IRI is read), so this stays decoupled
  // from interop's `ReceivedAggregation` — a `ReceivedAggregation[]` from the folded log is
  // assignable. Cross-domain composition happens at the caller (hook/test).
  received: { snapshotUri: string }[],
): Promise<AggregationSnapshot[]> {
  const snapshots = await mapPooled(
    received,
    4,
    // Per-item tolerance: one unreadable foreign snapshot (revoked, throttled)
    // must not fail the whole fold — loadComputedSnapshot throws on transient
    // failures by design (so the aggregation page can tell absence from failure).
    (rv) =>
      loadComputedSnapshot(gateway, rv.snapshotUri).catch((err) => {
        logError(`load received benchmark ${rv.snapshotUri}`, err);
        return null;
      }),
  );
  return snapshots.filter(
    (s): s is AggregationSnapshot => s !== null && Boolean(s.isBenchmark),
  );
}

/**
 * Get computed snapshot for an aggregation by aggregation ID
 * @operation query
 */
export async function getComputedSnapshotByAggregationId(
  gateway: PodGateway,
  aggregationId: string,
): Promise<AggregationSnapshot | null> {
  if (!gateway.webId) return null;
  const snapshotUri = getComputedSnapshotUri(gateway.webId, aggregationId);
  return loadComputedSnapshot(gateway, snapshotUri);
}

/**
 * Delete an aggregation definition and its snapshot
 * @operation mutation
 */
export async function deleteAggregation(
  gateway: PodGateway,
  aggregationId: string,
): Promise<void> {
  const webId = gateway.webId;
  if (!webId) {
    throw new Error("User is not logged in");
  }

  // Container-native: deleting the definition resource de-registers the aggregation
  // (it's discovered by listing); also drop its snapshot and any ACLs.
  const definitionUri = getAggregationDefinitionUri(webId, aggregationId);
  const snapshotUri = getComputedSnapshotUri(webId, aggregationId);
  for (const url of [definitionUri, snapshotUri]) {
    await gateway.fetch(`${url}.acl`, { method: "DELETE" }).catch((err) =>
      logError("delete aggregation ACL", err)
    );
    await gateway.fetch(url, { method: "DELETE" }).catch((err) =>
      logError("delete aggregation resource", err)
    );
  }
}

/**
 * Get the snapshot URL for an aggregation
 */
export function getSnapshotUri(webId: string, aggregationId: string): string {
  return getComputedSnapshotUri(webId, aggregationId);
}

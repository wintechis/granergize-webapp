import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store, Writer } from "n3";
import { podResources } from "../pod/solidUtils.ts";
import type {
  AggregatedViewDefinition,
  AggregatedViewSnapshot,
} from "../../types.ts";
import {
  BENCH_COMPUTED_BY,
  BENCH_METRIC_PERIOD,
  BENCH_RESULT,
  CONSUMPTION_NS,
  RDF_TYPE,
  XSD_BOOLEAN,
  XSD_DATETIME,
  XSD_DECIMAL,
  XSD_GYEAR,
  XSD_INTEGER,
} from "../rdf/vocabularies.ts";
import { getQuadValue, getQuadValues } from "../rdf/rdfHelpers.ts";
import { fetchFresh, readStoreOrEmpty } from "../pod/podFetch.ts";
import { ensureContainer, readModifyWrite } from "../pod/podWrite.ts";
import { listDirectChildren } from "../pod/podDelete.ts";
import { mapPooled } from "../../lib/pool.ts";
import { logError } from "../../lib/logError.ts";

const { namedNode, literal, quad } = DataFactory;

const VOCAB_PREFIX = CONSUMPTION_NS;

/**
 * Standard prefixes for Turtle serialization
 */
const TTL_PREFIXES =
  `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
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

/** The `views/` container — one definition resource per view (discover by listing). */
function viewsContainerUri(webId: string): string {
  return podResources(webId).views;
}

/** The `views/snapshots/` container — one shareable computed copy per view. */
function snapshotsContainerUri(webId: string): string {
  return podResources(webId).viewSnapshots;
}

/** A single view definition resource: `views/<viewId>.ttl`. */
function getViewDefinitionUri(webId: string, viewId: string): string {
  return `${viewsContainerUri(webId)}${viewId}.ttl`;
}

/** A single computed snapshot resource: `views/snapshots/<viewId>.ttl`. */
function getComputedViewUri(webId: string, viewId: string): string {
  return `${snapshotsContainerUri(webId)}${viewId}.ttl`;
}

/** The definition's subject node (a fragment of its own resource). */
function viewNodeFor(webId: string, viewId: string) {
  return namedNode(`${getViewDefinitionUri(webId, viewId)}#view`);
}

/** Ensure the `views/` and `views/snapshots/` containers exist (parent first).
 * A creation failure propagates here, instead of resurfacing later as a
 * confusing view-PUT failure. */
async function ensureViewsDirectoryExists(session: Session): Promise<void> {
  const webId = session.info.webId;
  if (!webId) {
    throw new Error("User is not logged in");
  }

  await ensureContainer(viewsContainerUri(webId), session);
  await ensureContainer(snapshotsContainerUri(webId), session);
}

/**
 * Generate a unique view ID — collision-free via crypto.randomUUID (the same
 * fix as building file ids; a timestamp+short-random id could collide in a
 * tight loop).
 */
function generateViewId(): string {
  return `view-${crypto.randomUUID()}`;
}

/**
 * Create a new aggregated view definition
 * @operation mutation
 */
export async function createViewDefinition(
  session: Session,
  name: string,
  buildingUris: string[],
  aggregationType: AggregatedViewDefinition["aggregationType"],
  metrics: string[],
  opts: { period?: string; benchmark?: boolean } = {},
): Promise<AggregatedViewDefinition> {
  const { period, benchmark } = opts;
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  await ensureViewsDirectoryExists(session);

  const viewId = generateViewId();
  const now = new Date().toISOString();
  const webId = session.info.webId;
  const definitionUri = getViewDefinitionUri(webId, viewId);

  const newView: AggregatedViewDefinition = {
    id: viewId,
    name,
    buildingUris,
    aggregationType,
    metrics,
    createdAt: now,
    ...(period ? { period } : {}),
    ...(benchmark ? { benchmark } : {}),
  };

  const viewNode = viewNodeFor(webId, viewId);

  // One resource per view (opaque id ⇒ collision-free), so a plain PUT suffices —
  // no shared mega-file to clobber.
  const store = new Store();
  store.addQuad(quad(
    viewNode,
    namedNode(RDF_TYPE),
    namedNode(`${VOCAB_PREFIX}AggregatedViewDefinition`),
  ));
  store.addQuad(quad(viewNode, namedNode(`${VOCAB_PREFIX}viewId`), literal(viewId)));
  store.addQuad(quad(viewNode, namedNode(`${VOCAB_PREFIX}viewName`), literal(name)));
  store.addQuad(quad(
    viewNode,
    namedNode(`${VOCAB_PREFIX}aggregationType`),
    literal(aggregationType),
  ));
  store.addQuad(quad(
    viewNode,
    namedNode(`${VOCAB_PREFIX}createdAt`),
    literal(now, namedNode(XSD_DATETIME)),
  ));
  if (period) {
    store.addQuad(quad(
      viewNode,
      namedNode(`${VOCAB_PREFIX}viewPeriod`),
      literal(period),
    ));
  }
  // The benchmark flag is PERSISTED on the definition (ground truth), so every
  // (re)compute — including a plain "Refresh Snapshot" — re-derives the
  // snapshot's bench:BenchmarkResult typing from it instead of relying on
  // call-site options that a refresh wouldn't know to pass.
  if (benchmark) {
    store.addQuad(quad(
      viewNode,
      namedNode(`${VOCAB_PREFIX}benchmark`),
      literal("true", namedNode(XSD_BOOLEAN)),
    ));
  }
  // Building URIs (private, only in the definition file).
  for (const buildingUri of buildingUris) {
    store.addQuad(quad(
      viewNode,
      namedNode(`${VOCAB_PREFIX}includesBuilding`),
      namedNode(buildingUri),
    ));
  }
  for (const metric of metrics) {
    store.addQuad(quad(
      viewNode,
      namedNode(`${VOCAB_PREFIX}includesMetric`),
      literal(metric),
    ));
  }

  const res = await session.fetch(definitionUri, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: serializeWithPrefixes(store),
  });
  if (!res.ok) {
    throw new Error(`Failed to create view definition: ${res.statusText}`);
  }

  return newView;
}

/** Extract an {@link AggregatedViewDefinition} from a parsed definition store. */
function parseViewDefinition(store: Store): AggregatedViewDefinition | null {
  const viewType = namedNode(`${VOCAB_PREFIX}AggregatedViewDefinition`);
  const viewNode = store.getQuads(null, namedNode(RDF_TYPE), viewType, null)[0]
    ?.subject;
  if (!viewNode) return null;
  return {
    id: getQuadValue(store, viewNode, namedNode(`${VOCAB_PREFIX}viewId`)) ?? "",
    name: getQuadValue(store, viewNode, namedNode(`${VOCAB_PREFIX}viewName`)) ??
      "",
    aggregationType: (getQuadValue(
      store,
      viewNode,
      namedNode(`${VOCAB_PREFIX}aggregationType`),
    ) ?? "average") as AggregatedViewDefinition["aggregationType"],
    createdAt:
      getQuadValue(store, viewNode, namedNode(`${VOCAB_PREFIX}createdAt`)) ?? "",
    lastComputedAt: getQuadValue(
      store,
      viewNode,
      namedNode(`${VOCAB_PREFIX}lastComputedAt`),
    ),
    buildingUris: getQuadValues(
      store,
      viewNode,
      namedNode(`${VOCAB_PREFIX}includesBuilding`),
    ),
    metrics: getQuadValues(
      store,
      viewNode,
      namedNode(`${VOCAB_PREFIX}includesMetric`),
    ),
    period: getQuadValue(store, viewNode, namedNode(`${VOCAB_PREFIX}viewPeriod`)),
    ...(getQuadValue(store, viewNode, namedNode(`${VOCAB_PREFIX}benchmark`)) ===
        "true"
      ? { benchmark: true }
      : {}),
  };
}

/**
 * All view definitions for the current user, discovered by LISTING the `views/`
 * container (the top-level `*.ttl` resources; the `snapshots/` subfolder is
 * skipped) and parsing each. A missing container (fresh Pod) yields `[]`.
 * @operation query
 */
export async function getViewDefinitions(
  session: Session,
): Promise<AggregatedViewDefinition[]> {
  const webId = session.info.webId;
  if (!session.info.isLoggedIn || !webId) {
    throw new Error("User is not logged in");
  }

  // No try/catch: a real network/parse failure propagates to React Query (which
  // keeps the last good views via keepPreviousData). The legitimate empty — the
  // container doesn't exist yet — is the explicit `if (!children) return []` below,
  // so it stays distinct from "the read failed".
  const children = await listDirectChildren(viewsContainerUri(webId), session);
  if (!children) return []; // container doesn't exist yet
  const defUris = children.filter((u) => u.endsWith(".ttl"));

  // Bounded concurrency: a burst of GETs trips Cloudflare's rate limiter.
  const views = await mapPooled(
    defUris,
    4,
    async (url) => parseViewDefinition(await readStoreOrEmpty(url, session)),
  );
  return views.filter((v): v is AggregatedViewDefinition => v !== null);
}

/**
 * A single view definition by ID — a direct read of `views/<viewId>.ttl` (no
 * need to list the whole container).
 * @operation query
 */
export async function getViewDefinition(
  session: Session,
  viewId: string,
): Promise<AggregatedViewDefinition | null> {
  const webId = session.info.webId;
  if (!webId) return null;
  try {
    const store = await readStoreOrEmpty(
      getViewDefinitionUri(webId, viewId),
      session,
    );
    return parseViewDefinition(store);
  } catch (error) {
    console.error("Error getting view definition:", error);
    return null;
  }
}

/**
 * Store a computed snapshot for a view
 * @operation mutation
 */
export async function storeComputedSnapshot(
  session: Session,
  snapshot: AggregatedViewSnapshot,
): Promise<string> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  await ensureViewsDirectoryExists(session);

  const snapshotUri = getComputedViewUri(session.info.webId, snapshot.id);
  const snapshotNode = namedNode(`${snapshotUri}#snapshot`);

  const store = new Store();

  // Add snapshot metadata
  store.addQuad(quad(
    snapshotNode,
    namedNode(RDF_TYPE),
    namedNode(`${VOCAB_PREFIX}AggregatedViewSnapshot`),
  ));

  store.addQuad(quad(
    snapshotNode,
    namedNode(`${VOCAB_PREFIX}viewId`),
    literal(snapshot.id),
  ));

  store.addQuad(quad(
    snapshotNode,
    namedNode(`${VOCAB_PREFIX}viewName`),
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
  // gra:AggregatedViewSnapshot too, so every existing reader keeps working.
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

  // Add metrics
  for (const metric of snapshot.metrics) {
    store.addQuad(quad(
      snapshotNode,
      namedNode(`${VOCAB_PREFIX}includesMetric`),
      literal(metric),
    ));
  }

  // Add computed values. Full precision — rounding the GROUND value to two
  // decimals lost real precision (share-% metrics, sums over 15-min readings);
  // display formatting is the UI's job. `toFixed(20)` would be invalid lexical
  // xsd:decimal for huge floats; plain String() of a finite number is fine
  // except exponent forms, which we expand via toFixed's integer-digit form.
  for (const [metric, value] of Object.entries(snapshot.values)) {
    const lexical = Number.isInteger(value)
      ? String(value)
      : String(value).includes("e")
      ? value.toFixed(10)
      : String(value);
    store.addQuad(quad(
      snapshotNode,
      namedNode(`${VOCAB_PREFIX}${metric}Value`),
      literal(lexical, namedNode(XSD_DECIMAL)),
    ));
  }

  // Serialize and save
  const ttl = serializeWithPrefixes(store);

  const putResponse = await session.fetch(snapshotUri, {
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
  await updateViewLastComputed(session, snapshot.id, snapshot.computedAt);

  return snapshotUri;
}

/**
 * Update the lastComputedAt timestamp in a view definition
 */
async function updateViewLastComputed(
  session: Session,
  viewId: string,
  timestamp: string,
): Promise<void> {
  const webId = session.info.webId;
  if (!webId) return;

  const definitionUri = getViewDefinitionUri(webId, viewId);
  const viewNode = viewNodeFor(webId, viewId);
  const lastComputedPred = namedNode(`${VOCAB_PREFIX}lastComputedAt`);

  await readModifyWrite(definitionUri, session, (store, { created }) => {
    if (created) return false; // no definition file → nothing to update
    store.getQuads(viewNode, lastComputedPred, null, null)
      .forEach((q) => store.removeQuad(q));
    store.addQuad(quad(
      viewNode,
      lastComputedPred,
      literal(timestamp, namedNode(XSD_DATETIME)),
    ));
  }, { serialize: serializeWithPrefixes });
}

/**
 * Load a computed snapshot from URL.
 *
 * Distinguishes ABSENCE from FAILURE: `null` means the snapshot genuinely does
 * not exist (404/410, or the document isn't a snapshot) — the signal the view
 * page's auto-compute keys on. Any transient failure (throttling, network,
 * unparseable response) THROWS instead: returning `null` there once made a
 * failed read of an EXISTING snapshot trigger a snapshot-overwriting recompute.
 * Callers that want per-item tolerance (e.g. folding received benchmarks)
 * catch per snapshot.
 * @operation query
 */
export async function loadComputedSnapshot(
  session: Session,
  snapshotUri: string,
): Promise<AggregatedViewSnapshot | null> {
  const response = await fetchFresh(snapshotUri, session);
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

  const snapshotType = namedNode(`${VOCAB_PREFIX}AggregatedViewSnapshot`);
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
  const values: Record<string, number> = {};
  for (const metric of metrics) {
    const v = getQuadValue(
      store,
      snapshotNode,
      namedNode(`${VOCAB_PREFIX}${metric}Value`),
    );
    if (v !== undefined) values[metric] = parseFloat(v);
  }

  return {
    id: getQuadValue(store, snapshotNode, namedNode(`${VOCAB_PREFIX}viewId`)) ??
      "",
    name: getQuadValue(
      store,
      snapshotNode,
      namedNode(`${VOCAB_PREFIX}viewName`),
    ) ?? "",
    aggregationType: (getQuadValue(
      store,
      snapshotNode,
      namedNode(`${VOCAB_PREFIX}aggregationType`),
    ) ?? "average") as AggregatedViewSnapshot["aggregationType"],
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
  };
}

/**
 * Load the given received views' snapshots and keep the ones marked as a
 * benchmark result — what the energy view compares the owner's own figures
 * against. Takes the already-derived received views (from the folded
 * `shared-in/` log) so it performs no fold of its own; unreadable or
 * non-benchmark snapshots are dropped.
 * @operation query
 */
export async function getReceivedBenchmarksFor(
  session: Session,
  // Structural shape (only the snapshot IRI is read), so this stays decoupled
  // from interop's `ReceivedView` — a `ReceivedView[]` from the folded log is
  // assignable. Cross-domain composition happens at the caller (hook/test).
  received: { snapshotUri: string }[],
): Promise<AggregatedViewSnapshot[]> {
  const snapshots = await mapPooled(
    received,
    4,
    // Per-item tolerance: one unreadable foreign snapshot (revoked, throttled)
    // must not fail the whole fold — loadComputedSnapshot throws on transient
    // failures by design (so the view page can tell absence from failure).
    (rv) =>
      loadComputedSnapshot(session, rv.snapshotUri).catch((err) => {
        logError(`load received benchmark ${rv.snapshotUri}`, err);
        return null;
      }),
  );
  return snapshots.filter(
    (s): s is AggregatedViewSnapshot => s !== null && Boolean(s.isBenchmark),
  );
}

/**
 * Get computed snapshot for a view by view ID
 * @operation query
 */
export async function getComputedSnapshotByViewId(
  session: Session,
  viewId: string,
): Promise<AggregatedViewSnapshot | null> {
  if (!session.info.webId) return null;
  const snapshotUri = getComputedViewUri(session.info.webId, viewId);
  return loadComputedSnapshot(session, snapshotUri);
}

/**
 * Delete a view definition and its snapshot
 * @operation mutation
 */
export async function deleteView(
  session: Session,
  viewId: string,
): Promise<void> {
  const webId = session.info.webId;
  if (!session.info.isLoggedIn || !webId) {
    throw new Error("User is not logged in");
  }

  // Container-native: deleting the definition resource de-registers the view
  // (it's discovered by listing); also drop its snapshot and any ACLs.
  const definitionUri = getViewDefinitionUri(webId, viewId);
  const snapshotUri = getComputedViewUri(webId, viewId);
  for (const url of [definitionUri, snapshotUri]) {
    await session.fetch(`${url}.acl`, { method: "DELETE" }).catch((err) =>
      logError("delete view ACL", err)
    );
    await session.fetch(url, { method: "DELETE" }).catch((err) =>
      logError("delete view resource", err)
    );
  }
}

/**
 * Get the snapshot URL for a view
 */
export function getSnapshotUri(webId: string, viewId: string): string {
  return getComputedViewUri(webId, viewId);
}

import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store, Writer } from "n3";
import { appRoot } from "../utils/solidUtils.ts";
import type {
  AggregatedViewDefinition,
  AggregatedViewSnapshot,
} from "../../../types/types.ts";
import {
  GRAN_NS,
  RDF_TYPE,
  XSD_DATETIME,
  XSD_DECIMAL,
  XSD_INTEGER,
} from "../utils/vocabularies.ts";
import { getQuadValue, getQuadValues } from "../utils/rdfHelpers.ts";
import { fetchFresh } from "../utils/podFetch.ts";
import { readModifyWrite } from "../utils/podWrite.ts";
import { listDirectChildren } from "../utils/podDelete.ts";
import { mapPooled } from "../utils/pool.ts";

const { namedNode, literal, quad } = DataFactory;

const VOCAB_PREFIX = GRAN_NS;

/**
 * Standard prefixes for Turtle serialization
 */
const TTL_PREFIXES =
  `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix gra: <${VOCAB_PREFIX}> .

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
function viewsContainerUrl(webId: string): string {
  return `${appRoot(webId)}views/`;
}

/** The `views/snapshots/` container — one shareable computed copy per view. */
function snapshotsContainerUrl(webId: string): string {
  return `${appRoot(webId)}views/snapshots/`;
}

/** A single view definition resource: `views/<viewId>.ttl`. */
function getViewDefinitionUrl(webId: string, viewId: string): string {
  return `${viewsContainerUrl(webId)}${viewId}.ttl`;
}

/** A single computed snapshot resource: `views/snapshots/<viewId>.ttl`. */
function getComputedViewUrl(webId: string, viewId: string): string {
  return `${snapshotsContainerUrl(webId)}${viewId}.ttl`;
}

/** The definition's subject node (a fragment of its own resource). */
function viewNodeFor(webId: string, viewId: string) {
  return namedNode(`${getViewDefinitionUrl(webId, viewId)}#view`);
}

/** Ensure the `views/` and `views/snapshots/` containers exist. */
async function ensureViewsDirectoryExists(session: Session): Promise<void> {
  const webId = session.info.webId;
  if (!webId) {
    throw new Error("User is not logged in");
  }

  for (const dir of [viewsContainerUrl(webId), snapshotsContainerUrl(webId)]) {
    try {
      const response = await session.fetch(dir, { method: "HEAD" });
      if (response.status === 404) {
        await session.fetch(dir, {
          method: "PUT",
          headers: { "Content-Type": "text/turtle" },
          body: "",
        });
      }
    } catch {
      // Directory might already exist
    }
  }
}

/**
 * Generate a unique view ID
 */
function generateViewId(): string {
  return `view-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a new aggregated view definition
 */
export async function createViewDefinition(
  session: Session,
  name: string,
  buildingUris: string[],
  aggregationType: AggregatedViewDefinition["aggregationType"],
  metrics: string[],
  period?: string,
): Promise<AggregatedViewDefinition> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  await ensureViewsDirectoryExists(session);

  const viewId = generateViewId();
  const now = new Date().toISOString();
  const webId = session.info.webId;
  const definitionUrl = getViewDefinitionUrl(webId, viewId);

  const newView: AggregatedViewDefinition = {
    id: viewId,
    name,
    buildingUris,
    aggregationType,
    metrics,
    createdAt: now,
    ...(period ? { period } : {}),
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

  const res = await session.fetch(definitionUrl, {
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
  };
}

/**
 * All view definitions for the current user, discovered by LISTING the `views/`
 * container (the top-level `*.ttl` resources; the `snapshots/` subfolder is
 * skipped) and parsing each. A missing container (fresh Pod) yields `[]`.
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
  const children = await listDirectChildren(viewsContainerUrl(webId), session);
  if (!children) return []; // container doesn't exist yet
  const defUrls = children.filter((u) => u.endsWith(".ttl"));

  // Bounded concurrency: a burst of GETs trips Cloudflare's rate limiter.
  const views = await mapPooled(defUrls, 4, async (url) => {
    const res = await fetchFresh(url, session);
    if (!res.ok) return null;
    const store = new Store(
      new Parser({ baseIRI: url }).parse(await res.text()),
    );
    return parseViewDefinition(store);
  });
  return views.filter((v): v is AggregatedViewDefinition => v !== null);
}

/**
 * A single view definition by ID — a direct read of `views/<viewId>.ttl` (no
 * need to list the whole container).
 */
export async function getViewDefinition(
  session: Session,
  viewId: string,
): Promise<AggregatedViewDefinition | null> {
  const webId = session.info.webId;
  if (!webId) return null;
  try {
    const res = await fetchFresh(getViewDefinitionUrl(webId, viewId), session);
    if (!res.ok) return null;
    const store = new Store(
      new Parser({ baseIRI: getViewDefinitionUrl(webId, viewId) })
        .parse(await res.text()),
    );
    return parseViewDefinition(store);
  } catch (error) {
    console.error("Error getting view definition:", error);
    return null;
  }
}

/**
 * Store a computed snapshot for a view
 */
export async function storeComputedSnapshot(
  session: Session,
  snapshot: AggregatedViewSnapshot,
): Promise<string> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  await ensureViewsDirectoryExists(session);

  const snapshotUrl = getComputedViewUrl(session.info.webId, snapshot.id);
  const snapshotNode = namedNode(`${snapshotUrl}#snapshot`);

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

  // Add metrics
  for (const metric of snapshot.metrics) {
    store.addQuad(quad(
      snapshotNode,
      namedNode(`${VOCAB_PREFIX}includesMetric`),
      literal(metric),
    ));
  }

  // Add computed values
  for (const [metric, value] of Object.entries(snapshot.values)) {
    store.addQuad(quad(
      snapshotNode,
      namedNode(`${VOCAB_PREFIX}${metric}Value`),
      literal(value.toFixed(2), namedNode(XSD_DECIMAL)),
    ));
  }

  // Serialize and save
  const ttl = serializeWithPrefixes(store);

  const putResponse = await session.fetch(snapshotUrl, {
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

  return snapshotUrl;
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

  const definitionUrl = getViewDefinitionUrl(webId, viewId);
  const viewNode = viewNodeFor(webId, viewId);
  const lastComputedPred = namedNode(`${VOCAB_PREFIX}lastComputedAt`);

  await readModifyWrite(definitionUrl, session, (store, { created }) => {
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
 * Load a computed snapshot from URL
 */
export async function loadComputedSnapshot(
  session: Session,
  snapshotUrl: string,
): Promise<AggregatedViewSnapshot | null> {
  try {
    const response = await fetchFresh(snapshotUrl, session);
    if (!response.ok) {
      return null;
    }

    const text = await response.text();
    const parser = new Parser({ format: "text/turtle", baseIRI: snapshotUrl });
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
      id:
        getQuadValue(store, snapshotNode, namedNode(`${VOCAB_PREFIX}viewId`)) ??
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
    };
  } catch (error) {
    console.error("Error loading computed snapshot:", error);
    return null;
  }
}

/**
 * Get computed snapshot for a view by view ID
 */
export async function getComputedSnapshotByViewId(
  session: Session,
  viewId: string,
): Promise<AggregatedViewSnapshot | null> {
  if (!session.info.webId) return null;
  const snapshotUrl = getComputedViewUrl(session.info.webId, viewId);
  return loadComputedSnapshot(session, snapshotUrl);
}

/**
 * Delete a view definition and its snapshot
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
  const definitionUrl = getViewDefinitionUrl(webId, viewId);
  const snapshotUrl = getComputedViewUrl(webId, viewId);
  for (const url of [definitionUrl, snapshotUrl]) {
    await session.fetch(`${url}.acl`, { method: "DELETE" }).catch(() => {});
    await session.fetch(url, { method: "DELETE" }).catch(() => {});
  }
}

/**
 * Get the snapshot URL for a view
 */
export function getSnapshotUrl(webId: string, viewId: string): string {
  return getComputedViewUrl(webId, viewId);
}

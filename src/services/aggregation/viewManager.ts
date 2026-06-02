import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store, Writer } from "n3";
import { getStorageRoot } from "../utils/solidUtils.ts";
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

/**
 * Get the URL for the view definitions file
 */
function getViewDefinitionsUrl(webId: string): string {
  const storageRoot = getStorageRoot(webId);
  return `${storageRoot}granergize/views/viewDefinitions.ttl`;
}

/**
 * Get the URL for a computed view snapshot
 */
function getComputedViewUrl(webId: string, viewId: string): string {
  const storageRoot = getStorageRoot(webId);
  return `${storageRoot}granergize/views/computed/${viewId}.ttl`;
}

/**
 * Ensure the views directory structure exists
 */
async function ensureViewsDirectoryExists(session: Session): Promise<void> {
  const webId = session.info.webId;
  if (!webId) {
    throw new Error("User is not logged in");
  }

  const storageRoot = getStorageRoot(webId);
  const viewsDir = `${storageRoot}granergize/views/`;
  const computedDir = `${storageRoot}granergize/views/computed/`;

  // Create views directory
  try {
    const response = await session.fetch(viewsDir, { method: "HEAD" });
    if (response.status === 404) {
      await session.fetch(viewsDir, {
        method: "PUT",
        headers: { "Content-Type": "text/turtle" },
        body: "",
      });
    }
  } catch {
    // Directory might already exist
  }

  // Create computed subdirectory
  try {
    const response = await session.fetch(computedDir, { method: "HEAD" });
    if (response.status === 404) {
      await session.fetch(computedDir, {
        method: "PUT",
        headers: { "Content-Type": "text/turtle" },
        body: "",
      });
    }
  } catch {
    // Directory might already exist
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
  const definitionsUrl = getViewDefinitionsUrl(session.info.webId);

  const newView: AggregatedViewDefinition = {
    id: viewId,
    name,
    buildingUris,
    aggregationType,
    metrics,
    createdAt: now,
    ...(period ? { period } : {}),
  };

  const viewNode = namedNode(`${definitionsUrl}#${viewId}`);

  // Append the new view definition to the file, guarded by optimistic locking so
  // concurrent view creates don't clobber each other.
  await readModifyWrite(definitionsUrl, session, (store) => {
    store.addQuad(quad(
      viewNode,
      namedNode(RDF_TYPE),
      namedNode(`${VOCAB_PREFIX}AggregatedViewDefinition`),
    ));
    store.addQuad(quad(
      viewNode,
      namedNode(`${VOCAB_PREFIX}viewId`),
      literal(viewId),
    ));
    store.addQuad(quad(
      viewNode,
      namedNode(`${VOCAB_PREFIX}viewName`),
      literal(name),
    ));
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
  }, { serialize: serializeWithPrefixes });

  return newView;
}

/**
 * Get all view definitions for the current user
 */
export async function getViewDefinitions(
  session: Session,
): Promise<AggregatedViewDefinition[]> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  const definitionsUrl = getViewDefinitionsUrl(session.info.webId);

  try {
    // Cache-buster + no-store so the list reflects recent edits (e.g. a just
    // deleted view) instead of a stale cached copy. baseIRI below stays
    // canonical (without the query) so parsed IRIs are unchanged.
    const response = await fetchFresh(definitionsUrl, session);

    if (response.status === 404) {
      await session.fetch(definitionsUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/turtle" },
        body: "",
      });

      return [];
    }
    if (!response.ok) {
      throw new Error(
        `Failed to fetch view definitions: ${response.statusText}`,
      );
    }

    const text = await response.text();
    const parser = new Parser({
      format: "text/turtle",
      baseIRI: definitionsUrl,
    });
    const quads = parser.parse(text);
    const store = new Store(quads);

    const viewType = namedNode(`${VOCAB_PREFIX}AggregatedViewDefinition`);
    const viewQuads = store.getQuads(null, namedNode(RDF_TYPE), viewType, null);

    const views: AggregatedViewDefinition[] = [];

    for (const viewQuad of viewQuads) {
      const viewNode = viewQuad.subject;

      views.push({
        id: getQuadValue(store, viewNode, namedNode(`${VOCAB_PREFIX}viewId`)) ??
          "",
        name:
          getQuadValue(store, viewNode, namedNode(`${VOCAB_PREFIX}viewName`)) ??
            "",
        aggregationType: (getQuadValue(
          store,
          viewNode,
          namedNode(`${VOCAB_PREFIX}aggregationType`),
        ) ?? "average") as AggregatedViewDefinition["aggregationType"],
        createdAt: getQuadValue(
          store,
          viewNode,
          namedNode(`${VOCAB_PREFIX}createdAt`),
        ) ?? "",
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
        period: getQuadValue(
          store,
          viewNode,
          namedNode(`${VOCAB_PREFIX}viewPeriod`),
        ),
      });
    }

    return views;
  } catch (error) {
    console.error("Error getting view definitions:", error);
    return [];
  }
}

/**
 * Get a single view definition by ID
 */
export async function getViewDefinition(
  session: Session,
  viewId: string,
): Promise<AggregatedViewDefinition | null> {
  const views = await getViewDefinitions(session);
  return views.find((v) => v.id === viewId) || null;
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

  console.log(ttl);

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
  if (!session.info.webId) return;

  const definitionsUrl = getViewDefinitionsUrl(session.info.webId);
  const viewNode = namedNode(`${definitionsUrl}#${viewId}`);
  const lastComputedPred = namedNode(`${VOCAB_PREFIX}lastComputedAt`);

  await readModifyWrite(definitionsUrl, session, (store, { created }) => {
    if (created) return false; // no definitions file → nothing to update
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
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  const definitionsUrl = getViewDefinitionsUrl(session.info.webId);
  const snapshotUrl = getComputedViewUrl(session.info.webId, viewId);

  // Remove from definitions. Read fresh (no-store) so we edit the current file,
  // not a cached copy.
  const response = await fetchFresh(definitionsUrl, session);
  if (response.ok) {
    const text = await response.text();
    const parser = new Parser({
      format: "text/turtle",
      baseIRI: definitionsUrl,
    });
    const quads = parser.parse(text);
    const store = new Store(quads);

    const viewNode = namedNode(`${definitionsUrl}#${viewId}`);

    // Remove all quads related to this view
    const viewQuads = store.getQuads(viewNode, null, null, null);
    viewQuads.forEach((q) => store.removeQuad(q));

    const ttl = serializeWithPrefixes(store);

    await session.fetch(definitionsUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle" },
      body: ttl,
    });
  }

  // Delete snapshot file
  try {
    await session.fetch(snapshotUrl, { method: "DELETE" });
  } catch {
    // Snapshot might not exist, that's fine
  }

  // Delete ACL if exists
  try {
    await session.fetch(`${snapshotUrl}.acl`, { method: "DELETE" });
  } catch {
    // ACL might not exist
  }
}

/**
 * Get the snapshot URL for a view
 */
export function getSnapshotUrl(webId: string, viewId: string): string {
  return getComputedViewUrl(webId, viewId);
}

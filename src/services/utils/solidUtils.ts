/**
 * Utility functions for working with Solid POD URLs and WebIDs
 */
import type { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory } from "n3";
import { loadProfileStore } from "./profileDocument.ts";

const PIM_NS = "http://www.w3.org/ns/pim/space#";

/**
 * Storage root resolved from the WebID's `pim:storage`, cached per WebID for the
 * session. {@link getStorageRoot} reads this synchronously; {@link resolveStorageRoot}
 * populates it once at login.
 */
const storageRootCache = new Map<string, string>();

/**
 * Resolve the Pod storage root the Solid way: read `pim:storage` from the WebID
 * profile and cache it. Call once after login, before any data load.
 *
 * Throws if the profile is unreachable or declares no `pim:storage` — a pod that
 * doesn't advertise its storage is unusable, and we fail loudly here rather than
 * with a silently-wrong path later. (Previously the storage root was guessed by
 * string-munging the WebID, which broke for non-`/profile/card` WebID shapes.)
 *
 * @returns the storage root URL with a trailing slash
 */
export async function resolveStorageRoot(session: Session): Promise<string> {
  const webId = session.info.webId;
  if (!webId) throw new Error("No WebID in session");

  // Idempotent: once resolved, return the cached root without re-fetching, so it
  // can be awaited from multiple places (the app-startup gate + queries) cheaply.
  const cached = storageRootCache.get(webId);
  if (cached) return cached;

  const docUrl = webId.split("#")[0];
  // Read the profile via the shared cache so this first read is reused by the
  // org/avatar lookups that follow at login (one fetch instead of several).
  const store = await loadProfileStore(session);
  if (!store) {
    throw new Error(`Cannot read WebID profile at ${docUrl}`);
  }
  const roots = store.getObjects(
    DataFactory.namedNode(webId),
    DataFactory.namedNode(`${PIM_NS}storage`),
    null,
  );
  if (roots.length === 0) {
    throw new Error(
      `WebID profile ${docUrl} declares no pim:storage; cannot locate the Pod ` +
        `storage root.`,
    );
  }
  const root = roots[0].value.endsWith("/") ? roots[0].value : `${roots[0].value}/`;
  storageRootCache.set(webId, root);
  return root;
}

/**
 * The Pod storage root for a WebID (trailing slash), as resolved from
 * `pim:storage` by {@link resolveStorageRoot}. Synchronous so the many inline
 * call sites stay simple.
 *
 * Throws if not yet resolved — callers must run (and await) `resolveStorageRoot`
 * once at login before any path is built. There is no WebID string-munge fallback.
 *
 * @param webId - The WebID URL (with or without fragment)
 * @returns The storage root URL with trailing slash
 */
export function getStorageRoot(webId: string): string {
  const root = storageRootCache.get(webId);
  if (!root) {
    throw new Error(
      `Storage root for ${webId} not resolved — call resolveStorageRoot(session) ` +
        `at login before building Pod paths.`,
    );
  }
  return root;
}

/** Test seam: prime the storage-root cache without a network fetch. */
export function _setStorageRootForTesting(webId: string, root: string): void {
  storageRootCache.set(webId, root.endsWith("/") ? root : `${root}/`);
}

/**
 * Extract the base URL from a WebID (parent directory of the WebID document)
 * Example:
 *   Input: https://solid.ti.rw.fau.de/homer/profile/card#me
 *   Output: https://solid.ti.rw.fau.de/homer/profile/
 *
 * This is useful when you need the directory containing the WebID document,
 * not the storage root.
 *
 * @param webId - The WebID URL (with or without fragment)
 * @returns The base URL with trailing slash
 */
export function getPodBaseUrl(webId: string): string {
  return webId.substring(0, webId.lastIndexOf("/") + 1);
}

/**
 * Canonical URLs of the app's on-Pod RDF resources for a WebID. Single source of
 * truth — every app resource lives under one root, `getStorageRoot + "granergize/"`,
 * so callers never re-derive paths (which previously mixed `getPodBaseUrl` and
 * `getStorageRoot`, desyncing for non-`/profile/card` WebIDs). The org logo is the
 * one exception: it's profile data, stored at `profile/logo.<ext>` (see
 * organizationManager), not here.
 */
export function podResources(webId: string): {
  registry: string;
  buildings: string;
  views: string;
  viewDefinitions: string;
  computedViews: string;
  viewSharingRegistry: string;
  sharingRegistry: string;
  rooms: string;
  hiddenBuildings: string;
} {
  const app = `${getStorageRoot(webId)}granergize/`;
  return {
    registry: `${app}dataSources.ttl`,
    buildings: `${app}buildings/`,
    views: `${app}views/`,
    viewDefinitions: `${app}views/viewDefinitions.ttl`,
    computedViews: `${app}views/computed/`,
    viewSharingRegistry: `${app}views/viewSharingRegistry.ttl`,
    sharingRegistry: `${app}sharingRegistry.ttl`,
    rooms: `${app}rooms.ttl`,
    hiddenBuildings: `${app}hiddenBuildings.ttl`,
  };
}

/** The data-source registry URL — thin alias over {@link podResources}. */
export function registryUrl(webId: string): string {
  return podResources(webId).registry;
}

/**
 * Like {@link podResources} but returns null instead of throwing when the storage
 * root isn't resolved yet — for render paths (e.g. the RDF-source links) that may
 * run before login resolution completes.
 */
export function tryPodResources(
  webId: string,
): ReturnType<typeof podResources> | null {
  try {
    return podResources(webId);
  } catch {
    return null;
  }
}

/**
 * Utility functions for working with Solid POD URLs and WebIDs
 */
import type { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import { loadProfileStore } from "./profileDocument.ts";
import { logError } from "./logError.ts";

const PIM_NS = "http://www.w3.org/ns/pim/space#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/**
 * Fallback storage discovery for Pods whose WebID profile omits `pim:storage`
 * (e.g. freshly-provisioned CSS Pods, which type the root container `pim:Storage`
 * but don't advertise the triple on the card). Walk up from the WebID document's
 * container to the origin and return the first container TYPED `pim:Storage` — the
 * pod boundary — so path-based Pods (`…/alice/`) resolve to the pod, not the host.
 */
async function discoverStorageRoot(
  session: Session,
  docUrl: string,
): Promise<string | null> {
  const origin = `${new URL(docUrl).origin}/`;
  // Start at the WebID document's container.
  let url = docUrl.replace(/[^/]*$/, "");
  for (let i = 0; i < 8; i++) {
    const res = await session.fetch(url, { headers: { Accept: "text/turtle" } })
      .catch((err) => {
        logError("fetch container while walking to storage root", err);
        return null;
      });
    if (res && res.ok) {
      const store = new Store(new Parser({ baseIRI: url }).parse(await res.text()));
      const isStorage = store.getQuads(
        DataFactory.namedNode(url),
        DataFactory.namedNode(RDF_TYPE),
        DataFactory.namedNode(`${PIM_NS}Storage`),
        null,
      ).length > 0;
      if (isStorage) return url;
    } else {
      await res?.body?.cancel();
    }
    if (url === origin) break;
    const parent = url.replace(/[^/]+\/$/, "");
    if (parent === url || !parent.startsWith(origin)) break;
    url = parent;
  }
  return null;
}

/**
 * Storage root resolved from the WebID's `pim:storage`, cached per WebID for the
 * session. {@link getStorageRoot} reads this synchronously; {@link resolveStorageRoot}
 * populates it once at login.
 */
const storageRootCache = new Map<string, string>();

/**
 * Resolve the Pod storage root the Solid way and cache it. Call once after login,
 * before any data load.
 *
 * Two discovery paths: (a) the fast path — read `pim:storage` from the WebID
 * profile; (b) fallback — if the profile omits it, walk up to the container TYPED
 * `pim:Storage` (the Solid storage-discovery convention). So a Pod that types its
 * root but doesn't advertise the triple (e.g. a fresh CSS Pod) still resolves.
 * Throws only if neither yields a root. (Previously: throw on missing `pim:storage`.)
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
  const fromTriple = roots[0]?.value;
  const root = fromTriple ?? await discoverStorageRoot(session, docUrl);
  if (!root) {
    throw new Error(
      `Cannot locate the Pod storage root for ${docUrl}: no pim:storage on the ` +
        `profile and no pim:Storage-typed container found above the WebID.`,
    );
  }
  const withSlash = root.endsWith("/") ? root : `${root}/`;
  storageRootCache.set(webId, withSlash);
  return withSlash;
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
 * Drop all cached storage roots. Called on logout / session-expiry so a
 * different user logging in on the same tab can't read the previous user's
 * resolved root (it's re-resolved at the next login via `resolveStorageRoot`).
 */
export function clearStorageRootCache(): void {
  storageRootCache.clear();
}

/**
 * The app's on-Pod collection segment (no surrounding slashes) — every app
 * resource lives under `<storageRoot><APP_DIR>/`. Defaults to `granergize`; the
 * Tier-4 browser e2e run sets `VITE_POD_APP_DIR=granergize-e2e` so those tests
 * write to a throwaway collection and NEVER touch the user's real `granergize/`
 * data. Read once here as the single source of truth for {@link appRoot} and
 * {@link podResources}. Vite injects `import.meta.env` in the browser build; under
 * `deno test` (Tiers 1–2) it's absent, so read defensively and fall back.
 */
const POD_ENV =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
export const APP_DIR: string = (POD_ENV?.VITE_POD_APP_DIR ?? "granergize")
  .replace(/^\/+|\/+$/g, "");

/** `<storageRoot><APP_DIR>/` — the root container of the app's Pod collection. */
export function appRoot(webId: string): string {
  return `${getStorageRoot(webId)}${APP_DIR}/`;
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
  appRoot: string;
  buildings: string;
  views: string;
  viewSnapshots: string;
  sharedIn: string;
  sharedOut: string;
  inbox: string;
  prefs: string;
  bookmarks: string;
  contacts: string;
} {
  const app = appRoot(webId);
  return {
    appRoot: app,
    buildings: `${app}buildings/`,
    views: `${app}views/`,
    viewSnapshots: `${app}views/snapshots/`,
    sharedIn: `${app}shared-in/`,
    sharedOut: `${app}shared-out/`,
    inbox: `${app}inbox/`, // default location; the actual one is discoverable (see inbox.ts)
    prefs: `${app}prefs.ttl`,
    bookmarks: `${app}bookmarks.ttl`,
    contacts: `${app}contacts.ttl`,
  };
}

/**
 * Resolve the storage root for an ARBITRARY WebID (e.g. a share recipient), via a
 * direct profile fetch: `pim:storage` if present, else walk up to the
 * `pim:Storage`-typed container. Unlike {@link resolveStorageRoot} this is not
 * cached and not tied to the session's own WebID.
 */
export async function resolveStorageRootForWebId(
  webId: string,
  session: Session,
): Promise<string> {
  const docUrl = webId.split("#")[0];
  const res = await session.fetch(docUrl, { headers: { Accept: "text/turtle" } })
    .catch((err) => {
      logError("fetch WebID profile for storage-root resolution", err);
      return null;
    });
  if (res?.ok) {
    const store = new Store(new Parser({ baseIRI: docUrl }).parse(await res.text()));
    const triple = store.getObjects(
      DataFactory.namedNode(webId),
      DataFactory.namedNode(`${PIM_NS}storage`),
      null,
    )[0]?.value;
    if (triple) return triple.endsWith("/") ? triple : `${triple}/`;
  } else {
    await res?.body?.cancel();
  }
  const walked = await discoverStorageRoot(session, docUrl);
  if (!walked) {
    throw new Error(`Cannot locate the storage root for ${webId}`);
  }
  return walked.endsWith("/") ? walked : `${walked}/`;
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
  } catch (err) {
    logError("build pod resources before storage root resolved", err);
    return null;
  }
}

import type { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import { fetchFresh, fetchUncached, readStoreOrEmpty } from "./podFetch.ts";
import { appRoot } from "./solidUtils.ts";
import { LDP_CONTAINS as LDP_CONTAINS_IRI } from "../rdf/vocabularies.ts";
import { logError } from "../../lib/logError.ts";
import { mapPooled } from "../../lib/pool.ts";

const LDP_CONTAINS = DataFactory.namedNode(LDP_CONTAINS_IRI);

/**
 * How many children to delete at once within a container. Mirrors the write-side
 * bound used to seed a 15-min series' daily files (`mapPooled(…, 8, …)` in
 * `buildingSerializer.ts`): a heavy subtree (a sub-hourly series is dozens of
 * daily files, each two sequential round-trips — resource then `.acl`) was
 * deleted serially, which overran on a slower server (the JSS bulk-delete
 * timeout). Bounded so a deep tree can't open hundreds of sockets at once.
 */
const DELETE_CONCURRENCY = 8;

/**
 * Max times {@link deleteContainerRecursive} re-reads a container that the server
 * reports is still non-empty (409) after we deleted every child the listing named.
 * A 409 there means the listing was INCOMPLETE — so we re-read (unconditionally) and
 * delete the now-revealed children rather than reporting a false-clean success. Bounds
 * the self-correction so a server that 409s forever can't loop indefinitely.
 */
const MAX_DELETE_ROUNDS = 3;

/** A delete that leaves the target gone: any 2xx, or 404 (already absent). */
const isGone = (status: number) =>
  (status >= 200 && status < 300) || status === 404;

/**
 * Recursively delete an LDP container and everything beneath it.
 *
 * A Solid (CSS) container can only be deleted once empty, and it may hold nested
 * sub-containers (e.g. `buildings/<id>/energy/`), so we descend depth-first:
 * list the container, recurse into child containers (URLs ending in `/`), delete
 * leaf resources, then delete the container itself. Per-resource ACLs are removed
 * (safely — see {@link deleteResourceThenAcl}). A 404 anywhere is "already gone".
 *
 * Two safeguards keep this from silently leaving residue (it had — a stale container
 * listing made the walk skip children, the non-empty container delete 409'd, and that
 * was swallowed into a false "clean", on both CSS and JSS):
 *  - the listing is read UNCONDITIONALLY ({@link fetchUncached}), so an ETag-collision
 *    304 can't answer with a stale body that omits children;
 *  - if the container delete still returns 409 (server says non-empty) after we cleared
 *    every listed child, the listing was incomplete — re-read and go again, up to
 *    {@link MAX_DELETE_ROUNDS}, instead of trusting it. A genuine un-deletable child or
 *    container surfaces as a thrown error, never a false success.
 * @operation mutation
 */
export async function deleteContainerRecursive(
  container: string,
  session: Session,
  signal?: AbortSignal,
): Promise<void> {
  for (let round = 1; round <= MAX_DELETE_ROUNDS; round++) {
    signal?.throwIfAborted();
    const listing = await fetchUncached(container, session);
    if (listing.status === 404) return; // already gone
    if (listing.ok) {
      const store = new Store(
        new Parser({ baseIRI: container }).parse(await listing.text()),
      );
      const children = store
        .getObjects(DataFactory.namedNode(container), LDP_CONTAINS, null)
        .map((o) => o.value);
      // Children are independent and the container can only be removed once they're
      // ALL gone, so delete them with bounded concurrency (then the container, below)
      // rather than one-at-a-time. A sub-container recurses (and fully empties)
      // before its own delete; the per-resource resource-then-`.acl` ordering stays
      // intact inside deleteResourceThenAcl.
      await mapPooled(children, DELETE_CONCURRENCY, async (child) => {
        signal?.throwIfAborted();
        if (child.endsWith("/")) {
          await deleteContainerRecursive(child, session, signal);
        } else {
          const status = await deleteResourceThenAcl(child, session);
          if (!isGone(status)) {
            throw new Error(`Failed to delete ${child} (HTTP ${status})`);
          }
        }
      });
    }
    signal?.throwIfAborted();
    const status = await deleteResourceThenAcl(container, session);
    if (isGone(status)) return; // emptied and removed
    if (status !== 409) {
      throw new Error(`Failed to delete ${container} (HTTP ${status})`);
    }
    // 409 Conflict: the container is still non-empty, so the listing we just walked
    // was incomplete. Re-read and delete again rather than reporting false success.
  }
  throw new Error(
    `Failed to empty ${container}: still non-empty after ${MAX_DELETE_ROUNDS} rounds`,
  );
}

/**
 * Delete a resource, THEN its now-orphaned `.acl` — in that order, so a resource
 * with a restrictive own ACL is never briefly exposed under the container's
 * (possibly more permissive) inherited ACL: a TOCTOU window we must not open. The
 * `.acl` is auxiliary, so it never blocks the resource/container delete.
 *
 * Only if the resource DELETE is forbidden (403 — typically a corrupt own `.acl`
 * that locked even the owner out) do we fall back to removing the `.acl` FIRST and
 * retrying: that resource is already broken and is being destroyed anyway, so the
 * brief fall-back exposure is an acceptable last resort, not the default path. A
 * 404 anywhere is "already gone".
 *
 * Returns the FINAL resource-DELETE status (does not throw on a non-ok one) so the
 * caller can react — chiefly a `409` on a non-empty container, which is not an
 * error but a signal to re-read and recurse (see {@link deleteContainerRecursive}).
 */
async function deleteResourceThenAcl(
  uri: string,
  session: Session,
): Promise<number> {
  // An `.acl` is itself an auxiliary resource — it has no `.acl` of its own — so
  // never derive `<uri>.acl.acl`. The walk can be handed an `.acl` to delete because
  // some servers (JSS) list `.acl` as an `ldp:contains` member (CSS does not); issuing
  // the nonexistent `.acl.acl` DELETE is wasted at best and has stalled a server's
  // teardown at worst. `null` = this resource has no associated ACL to clean up.
  const aclUri = uri.endsWith(".acl") ? null : `${uri}.acl`;
  let del = await session.fetch(uri, { method: "DELETE" });
  if (del.status === 403 && aclUri) {
    await session.fetch(aclUri, { method: "DELETE" }).catch((err) =>
      logError("delete resource ACL (lockout recovery)", err)
    );
    del = await session.fetch(uri, { method: "DELETE" });
  }
  // Drop the now-orphaned .acl only once the resource itself is gone (2xx/404), so a
  // resource still present (e.g. a non-empty 409 container) keeps its ACL until it is
  // actually removed — no exposure window, no premature ACL delete on a retry path.
  if (aclUri && isGone(del.status)) {
    await session.fetch(aclUri, { method: "DELETE" }).catch((err) =>
      logError("delete resource ACL", err)
    );
  }
  return del.status;
}

/**
 * Flat, depth-first list of every resource beneath a container (sub-containers
 * and the files within them) — what a {@link deleteContainerRecursive} call would
 * remove. Tolerates a missing container (returns `[]`). Read-only; for previewing
 * a delete before it happens.
 * @operation query
 */
export async function listContainedResources(
  container: string,
  session: Session,
): Promise<string[]> {
  const out: string[] = [];
  const store = await readStoreOrEmpty(container, session);
  const children = store
    .getObjects(DataFactory.namedNode(container), LDP_CONTAINS, null)
    .map((o) => o.value)
    .sort();
  for (const child of children) {
    out.push(child);
    if (child.endsWith("/")) {
      out.push(...await listContainedResources(child, session));
    }
  }
  return out;
}

/**
 * The direct `ldp:contains` children of a container (NON-recursive) — file IRIs
 * and immediate sub-container URLs (the latter end in `/`). Returns `null` when
 * the container itself doesn't exist (HTTP 404), so a caller can tell a *fresh*
 * Pod (no container) from an *empty* one (container present, no children) — e.g.
 * to seed demo data only on first run, not after the user deletes everything.
 * Any other non-OK response yields `[]`.
 * @operation query
 */
export async function listDirectChildren(
  container: string,
  session: Session,
): Promise<string[] | null> {
  const listing = await fetchFresh(container, session);
  if (listing.status === 404) return null;
  if (!listing.ok) return [];
  const store = new Store(
    new Parser({ baseIRI: container }).parse(await listing.text()),
  );
  return store
    .getObjects(DataFactory.namedNode(container), LDP_CONTAINS, null)
    .map((o) => o.value);
}

/**
 * Render a resource-URL list for a confirmation prompt: paths shown relative to
 * the storage root, one per line, capped with an "…and N more" summary so a
 * building with hundreds of daily energy files doesn't produce a wall of text.
 */
export function formatResourceList(
  urls: string[],
  root: string,
  max = 20,
): string {
  const rel = (u: string) => (root && u.startsWith(root) ? u.slice(root.length) : u);
  const shown = urls.slice(0, max).map((u) => `  • ${rel(u)}`);
  const extra = urls.length > max ? [`  …and ${urls.length - max} more`] : [];
  return [...shown, ...extra].join("\n");
}

/**
 * Remove the entire `granergize/` app collection from the user's Pod — every
 * building, energy file, view, data room, registry and setting under it. The
 * organisation logo lives in `profile/`, outside this tree, so it is untouched.
 * @operation mutation
 */
export async function removeAppData(
  session: Session,
  signal?: AbortSignal,
): Promise<void> {
  const webId = session.info.webId;
  if (!webId) throw new Error("Not logged in");
  const granDir = appRoot(webId);
  await deleteContainerRecursive(granDir, session, signal);
}

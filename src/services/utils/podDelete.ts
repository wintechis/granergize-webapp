import type { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import { fetchFresh } from "./podFetch.ts";
import { appRoot } from "./solidUtils.ts";
import { LDP_CONTAINS as LDP_CONTAINS_IRI } from "./vocabularies.ts";
import { logError } from "./logError.ts";

const LDP_CONTAINS = DataFactory.namedNode(LDP_CONTAINS_IRI);

/**
 * Recursively delete an LDP container and everything beneath it.
 *
 * A Solid (CSS) container can only be deleted once empty, and it may hold nested
 * sub-containers (e.g. `buildings/<id>/energy/`), so we descend depth-first:
 * list the container, recurse into child containers (URLs ending in `/`), delete
 * leaf resources, then delete the container itself. Per-resource ACLs are removed
 * best-effort. A 404 anywhere is treated as "already gone".
 */
export async function deleteContainerRecursive(
  container: string,
  session: Session,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const listing = await fetchFresh(container, session);
  if (listing.status === 404) return;
  if (listing.ok) {
    const store = new Store(
      new Parser({ baseIRI: container }).parse(await listing.text()),
    );
    const children = store
      .getObjects(DataFactory.namedNode(container), LDP_CONTAINS, null)
      .map((o) => o.value);
    for (const child of children) {
      signal?.throwIfAborted();
      if (child.endsWith("/")) {
        await deleteContainerRecursive(child, session, signal);
      } else {
        await session.fetch(`${child}.acl`, { method: "DELETE" }).catch((err) =>
          logError("delete child resource ACL", err)
        );
        const del = await session.fetch(child, { method: "DELETE" });
        if (!del.ok && del.status !== 404) {
          throw new Error(`Failed to delete ${child} (HTTP ${del.status})`);
        }
      }
    }
  }
  signal?.throwIfAborted();
  // Best-effort ACL removal; deleting the container is what matters.
  await session.fetch(`${container}.acl`, { method: "DELETE" }).catch((err) =>
    logError("delete container ACL", err)
  );
  const del = await session.fetch(container, { method: "DELETE" });
  if (!del.ok && del.status !== 404) {
    throw new Error(`Failed to delete container ${container} (HTTP ${del.status})`);
  }
}

/**
 * Flat, depth-first list of every resource beneath a container (sub-containers
 * and the files within them) — what a {@link deleteContainerRecursive} call would
 * remove. Tolerates a missing container (returns `[]`). Read-only; for previewing
 * a delete before it happens.
 */
export async function listContainedResources(
  container: string,
  session: Session,
): Promise<string[]> {
  const out: string[] = [];
  const listing = await fetchFresh(container, session);
  if (!listing.ok) return out;
  const store = new Store(
    new Parser({ baseIRI: container }).parse(await listing.text()),
  );
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
 * The direct `ldp:contains` children of a container (NON-recursive) — file URLs
 * and immediate sub-container URLs (the latter end in `/`). Returns `null` when
 * the container itself doesn't exist (HTTP 404), so a caller can tell a *fresh*
 * Pod (no container) from an *empty* one (container present, no children) — e.g.
 * to seed demo data only on first run, not after the user deletes everything.
 * Any other non-OK response yields `[]`.
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

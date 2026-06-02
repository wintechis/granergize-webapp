import type { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import { fetchFresh } from "./podFetch.ts";
import { getStorageRoot } from "./solidUtils.ts";

const LDP_CONTAINS = DataFactory.namedNode("http://www.w3.org/ns/ldp#contains");

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
): Promise<void> {
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
      if (child.endsWith("/")) {
        await deleteContainerRecursive(child, session);
      } else {
        await session.fetch(`${child}.acl`, { method: "DELETE" }).catch(() => {});
        const del = await session.fetch(child, { method: "DELETE" });
        if (!del.ok && del.status !== 404) {
          throw new Error(`Failed to delete ${child} (HTTP ${del.status})`);
        }
      }
    }
  }
  // Best-effort ACL removal; deleting the container is what matters.
  await session.fetch(`${container}.acl`, { method: "DELETE" }).catch(() => {});
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
export async function removeAppData(session: Session): Promise<void> {
  const webId = session.info.webId;
  if (!webId) throw new Error("Not logged in");
  const granDir = `${getStorageRoot(webId)}granergize/`;
  await deleteContainerRecursive(granDir, session);
}

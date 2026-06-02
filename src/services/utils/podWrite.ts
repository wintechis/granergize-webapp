import type { Session } from "@inrupt/solid-client-authn-browser";
import { Parser, Store, Writer } from "n3";
import { fetchFresh } from "./podFetch.ts";

/**
 * Thrown when a read-modify-write keeps losing the optimistic-locking race
 * (repeated 412/409). The caller should tell the user the resource changed
 * elsewhere and to retry.
 */
export class ConflictError extends Error {
  constructor(public url: string, message?: string) {
    super(message ?? `Conflicting concurrent edit to ${url}; please retry.`);
    this.name = "ConflictError";
  }
}

export interface RmwContext {
  /** True when the resource didn't exist (GET returned 404). */
  created: boolean;
}

/**
 * Conditional read-modify-write of a Turtle resource with optimistic locking.
 *
 * GET (cache-busted) → parse to an n3 Store → `mutate(store)` → PUT guarded by
 * `If-Match` (the GET's ETag) so a concurrent write can't be silently clobbered;
 * for a resource that doesn't exist yet, `If-None-Match: *` guards the create.
 * On 412/409 (someone wrote first) it re-reads and retries up to `retries` times,
 * then throws {@link ConflictError}. Servers that return no ETag degrade to a
 * plain PUT (no worse than the previous blind-PUT behavior).
 *
 * `mutate` may return `false` to abort the write entirely (e.g. nothing to remove
 * from a missing file). Any other return value (incl. n3's `addQuad` boolean) is
 * ignored.
 */
export async function readModifyWrite(
  url: string,
  session: Session,
  mutate: (store: Store, ctx: RmwContext) => void | boolean,
  opts: { retries?: number; serialize?: (store: Store) => string } = {},
): Promise<void> {
  const retries = opts.retries ?? 3;
  const serialize = opts.serialize ??
    ((store: Store) =>
      new Writer({ format: "text/turtle" }).quadsToString(
        store.getQuads(null, null, null, null),
      ));
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetchFresh(url, session);
    let store: Store;
    let etag: string | null = null;
    let created = false;
    if (res.status === 404) {
      store = new Store();
      created = true;
    } else if (res.ok) {
      store = new Store(new Parser({ baseIRI: url }).parse(await res.text()));
      etag = res.headers.get("ETag");
    } else {
      throw new Error(`Failed to read ${url}: HTTP ${res.status}`);
    }

    if (mutate(store, { created }) === false) return;

    const body = serialize(store);
    const headers: Record<string, string> = { "Content-Type": "text/turtle" };
    if (created) headers["If-None-Match"] = "*";
    else if (etag) headers["If-Match"] = etag;

    const put = await session.fetch(url, { method: "PUT", headers, body });
    if (put.ok) return;
    // 412 Precondition Failed / 409 Conflict → someone wrote first: re-read & retry.
    if (put.status === 412 || put.status === 409) continue;
    throw new Error(
      `Failed to write ${url}: HTTP ${put.status} ${put.statusText}`,
    );
  }
  throw new ConflictError(url);
}

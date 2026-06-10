import type { Session } from "@inrupt/solid-client-authn-browser";
import { Parser, Store, Writer } from "n3";
import { quadsToJsonLd } from "../rdf/rdfHelpers.ts";
import { fetchFresh } from "./podFetch.ts";
import { emitNotification } from "../../lib/notificationSink.ts";
import { APP_DIR } from "./solidUtils.ts";

/** The name to announce when an app container is provisioned, or null to stay
 * quiet. Only the structural folders — direct children of the app collection
 * (`<APP_DIR>/`) like `shared-out`, `shared-in` — are announced; deeper
 * per-content containers (a building's time-series, a data-room id) are created
 * silently so the notice stays meaningful and not noisy. */
function announceableContainer(containerUrl: string): string | null {
  const path = containerUrl.replace(/\/+$/, "");
  const marker = `/${APP_DIR}/`;
  const at = path.indexOf(marker);
  if (at < 0) return null;
  const tail = path.slice(at + marker.length);
  return tail && !tail.includes("/") ? tail : null;
}

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
/**
 * Ensure an LDP container exists (create it with an empty PUT if it 404s) so a
 * subsequent POST-to-append has somewhere to land. A non-404 response (it exists,
 * or an auth error) is left as-is. Shared by the event-log writers (data rooms,
 * sharing logs).
 *
 * Returns `true` only when it actually created the container this call, and tells
 * the user about it (a one-time "set up …" notice) — so first-time provisioning
 * of a lazily-created granergize folder isn't silent. Returns `false` when the
 * container already existed.
 * @operation mutation
 */
export async function ensureContainer(
  containerUrl: string,
  session: Session,
): Promise<boolean> {
  const head = await session.fetch(containerUrl, { method: "GET" });
  if (head.ok || head.status !== 404) return false;
  const put = await session.fetch(containerUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: "",
  });
  if (!put.ok) {
    throw new Error(`Failed to create container ${containerUrl} (HTTP ${put.status})`);
  }
  const label = announceableContainer(containerUrl);
  if (label) emitNotification(`Set up the "${label}" folder on this Pod`, "info");
  return true;
}

/**
 * Append one immutable Turtle resource to an append-only LDP container (the
 * model-1 event-sourced primitive): POST — the server mints the child IRI, so
 * concurrent appends never clobber. The one home for the POST + ok-check shared
 * by the event-log writers (sharing logs, data-room logs, inbox notifications);
 * callers keep their own {@link ensureContainer} where the container is theirs
 * to provision. `describeError` lets a caller substitute a domain-specific
 * message for the generic failure.
 * @operation mutation
 */
export async function appendToContainer(
  containerUrl: string,
  turtle: string,
  session: Session,
  opts: { describeError?: (res: Response) => string } = {},
): Promise<void> {
  const res = await session.fetch(containerUrl, {
    method: "POST",
    headers: { "Content-Type": "text/turtle" },
    body: turtle,
  });
  if (!res.ok) {
    throw new Error(
      opts.describeError?.(res) ??
        `Failed to append to ${containerUrl} (HTTP ${res.status})`,
    );
  }
}

/**
 * PUT a WAC `.acl` Turtle body, falling back to JSON-LD on 415. JSS rejects Turtle
 * for ACL resources (it requires `application/ld+json`); CSS/NSS accept Turtle and
 * never 415, so their path is unchanged. The single home for direct `.acl` writes
 * that don't go through {@link readModifyWrite} (which has the same fallback).
 * @operation mutation
 */
export async function putAcl(
  aclUrl: string,
  turtleBody: string,
  session: Session,
): Promise<Response> {
  const res = await session.fetch(aclUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: turtleBody,
  });
  if (res.ok || res.status !== 415) return res;
  const store = new Store(new Parser({ baseIRI: aclUrl }).parse(turtleBody));
  return await session.fetch(aclUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/ld+json" },
    body: quadsToJsonLd(store.getQuads(null, null, null, null)),
  });
}

/**
 * Conditional read-modify-write of a Turtle resource with optimistic locking.
 * @operation mutation
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
    // 415 Unsupported Media Type → the server rejects Turtle for this resource.
    // JSS demands `application/ld+json` for WAC `.acl` files; re-serialize the SAME
    // graph as JSON-LD and retry once. CSS/NSS accept Turtle and never 415, so
    // their path is untouched.
    if (put.status === 415) {
      const jsonld = quadsToJsonLd(store.getQuads(null, null, null, null));
      const put2 = await session.fetch(url, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/ld+json" },
        body: jsonld,
      });
      if (put2.ok) return;
      if (put2.status === 412 || put2.status === 409) continue;
      throw new Error(
        `Failed to write ${url}: HTTP ${put2.status} ${put2.statusText}`,
      );
    }
    // 412 Precondition Failed / 409 Conflict → someone wrote first: re-read & retry.
    if (put.status === 412 || put.status === 409) continue;
    throw new Error(
      `Failed to write ${url}: HTTP ${put.status} ${put.statusText}`,
    );
  }
  throw new ConflictError(url);
}

import type { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Writer } from "n3";
import type { Quad_Graph, Quad_Object, Term } from "@rdfjs/types";
import { listContainedResources } from "./podDelete.ts";
import { ensureContainer } from "./podWrite.ts";
import { appRoot } from "./solidUtils.ts";
import { createZip, readZip, type ZipEntry } from "../../lib/zip.ts";

/**
 * Dev-mode backup/restore of the whole app Pod collection as a single ZIP file.
 * Every non-container resource (building TTLs, energy series, views, data rooms,
 * prefs, AND binary file attachments) is fetched verbatim and stored under its
 * **app-collection-relative** path (e.g. `buildings/x.ttl`) — the `{APP_DIR}/`
 * segment is NOT baked in, so an archive taken from a `granergize/` collection
 * restores cleanly into a `granergize-dev/` (or e2e) one. A `manifest.json` at
 * the archive root records each entry's content type plus the source app
 * collection root (`base`, the absolute `{storageRoot}{APP_DIR}/`) so the restore
 * can PUT it back with the right `Content-Type` and rebase absolute IRIs onto a
 * different Pod / app collection.
 *
 * Restore is app-collection-relative: the archive replays into the *current*
 * session's app collection. Resource *paths* are collection-relative already, but
 * the resource *bodies* (Turtle) carry absolute IRIs anchored at the source
 * Pod/identity — so when restoring into a different Pod or app dir, each Turtle
 * resource is rebased
 * **term-precisely** (`rebaseTurtle`): parsed with n3, only `NamedNode` IRI terms
 * matching the source WebID / storage root are rewritten, then re-serialized.
 * Literals (even ones whose text contains the WebID) and blank nodes are left
 * intact — unlike blind string substitution. Non-Turtle resources (binaries) are
 * copied verbatim. That keeps cross-references (incl. the `shared-out/` log's
 * `interop:forResource` IRIs) valid, so a subsequent `reissueGrants` can replay
 * sharing on the new Pod. Containers are provisioned before their files. Developer
 * affordance: overwrites resources at matching paths (no merge, no ACL transfer)
 * — intended for a wiped target Pod.
 */

const MANIFEST_PATH = "manifest.json";
const ARCHIVE_VERSION = 3;

interface ArchiveManifest {
  version: number;
  /**
   * Absolute app collection root the archive was taken from (`{storageRoot}
   * {APP_DIR}/`), used for IRI rebasing. Entry paths are relative to this.
   */
  base?: string;
  /** The owner WebID the archive was taken from (rewritten on a cross-Pod restore). */
  webId?: string;
  /** App-collection-relative content type per entry path. */
  entries: Record<string, string>;
}

/** Rewrites applied when restoring onto a different Pod/identity/app collection. */
interface RebaseMap {
  oldWebId: string | null;
  newWebId: string;
  oldBase: string | null;
  newBase: string;
}

/** True when this content type is RDF we parse with n3 (term-precise rebase). */
function isTurtle(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.includes("turtle") || ct.includes("trig") ||
    ct.includes("n-triples") || ct.includes("n-quads");
}

/** Whether a rebase is needed at all (a WebID and/or storage-root change). */
function rebaseNeeded(m: RebaseMap): boolean {
  return (!!m.oldWebId && m.oldWebId !== m.newWebId) ||
    (!!m.oldBase && m.oldBase !== m.newBase);
}

/** Rewrite a single IRI: exact WebID first (it usually starts with the base), then base prefix. */
function rewriteIri(value: string, m: RebaseMap): string {
  if (m.oldWebId && value === m.oldWebId) return m.newWebId;
  if (m.oldBase && value.startsWith(m.oldBase)) {
    return m.newBase + value.slice(m.oldBase.length);
  }
  return value;
}

/**
 * RDF-term-precise rebase: parse the Turtle, rewrite only `NamedNode` IRI terms
 * (subjects/predicates/objects/graphs, plus literal datatype IRIs), and
 * re-serialize. Literals (even ones whose lexical value contains the WebID) and
 * blank nodes are left untouched — the win over blind string substitution. The
 * round-trip is lossy on formatting/comments but semantically identical; the app
 * re-parses on read.
 */
function rebaseTurtle(text: string, sourceUri: string, m: RebaseMap): string {
  const fixTerm = <T extends Term>(t: T): T => {
    if (t.termType === "NamedNode") {
      return DataFactory.namedNode(rewriteIri(t.value, m)) as unknown as T;
    }
    if (t.termType === "Literal" && t.datatype) {
      const dt = rewriteIri(t.datatype.value, m);
      if (dt !== t.datatype.value) {
        return DataFactory.literal(
          t.value,
          t.language || DataFactory.namedNode(dt),
        ) as unknown as T;
      }
    }
    return t;
  };
  const quads = new Parser({ baseIRI: sourceUri }).parse(text).map((q) =>
    DataFactory.quad(
      fixTerm(q.subject),
      fixTerm(q.predicate),
      fixTerm(q.object) as Quad_Object,
      fixTerm(q.graph) as Quad_Graph,
    )
  );
  return new Writer({ format: "text/turtle" }).quadsToString(quads);
}

export interface ExportResult {
  bytes: Uint8Array;
  /** Number of resources archived (excludes the manifest). */
  count: number;
}

/**
 * Fetch every resource under `granergize/` and pack it into a ZIP. The returned
 * bytes are ready to hand to a browser download. Throws if not logged in.
 * @operation query
 */
export async function exportArchive(
  session: Session,
  signal?: AbortSignal,
): Promise<ExportResult> {
  const webId = session.info.webId;
  if (!webId) throw new Error("Not logged in");
  const granDir = appRoot(webId);

  // Flat, recursive listing; drop containers (paths ending in "/") — they're
  // recreated on restore from the file paths.
  const all = await listContainedResources(granDir, session);
  const files = all.filter((u) => !u.endsWith("/"));

  const entries: ZipEntry[] = [];
  const manifest: ArchiveManifest = {
    version: ARCHIVE_VERSION,
    base: granDir,
    webId,
    entries: {},
  };
  for (const url of files) {
    signal?.throwIfAborted();
    if (!url.startsWith(granDir)) continue; // defensive: only in-collection resources
    const res = await session.fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to read ${url} (HTTP ${res.status})`);
    }
    const data = new Uint8Array(await res.arrayBuffer());
    // App-collection-relative path: the `{APP_DIR}/` segment is dropped so the
    // archive isn't pinned to the source's app-dir config.
    const path = url.slice(granDir.length);
    const contentType = res.headers.get("content-type")?.split(";")[0].trim() ||
      "application/octet-stream";
    entries.push({ path, data });
    manifest.entries[path] = contentType;
  }

  entries.unshift({
    path: MANIFEST_PATH,
    data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
  });

  return { bytes: createZip(entries), count: files.length };
}

export interface ImportOptions {
  signal?: AbortSignal;
  /**
   * App collection root (`{storageRoot}{APP_DIR}/`) to restore into. Defaults to
   * the current session's collection. Resource paths are written under this root
   * and textual bodies are rebased `manifest.base` → here.
   */
  targetBase?: string;
  /**
   * WebID to rewrite the archive's owner WebID to. Defaults to the current
   * session's WebID. Lets a cross-Pod restore re-anchor `prov:agent`/`grantee`/
   * owner references on the new identity.
   */
  targetWebId?: string;
}

export interface ImportResult {
  /** Number of resources written back to the Pod. */
  restored: number;
  /** Source root the bodies were rebased from, when a rewrite happened (else null). */
  rebasedFrom: string | null;
  /** Target root the bodies were rebased to, when a rewrite happened (else null). */
  rebasedTo: string | null;
  /** Target WebID the owner WebID was rewritten to, when it changed (else null). */
  rebasedWebId: string | null;
}

/** Inspect an archive without writing anything — for a restore confirmation. */
export function inspectArchive(
  zipBytes: Uint8Array,
): { count: number; base: string | null; webId: string | null } {
  const all = readZip(zipBytes);
  const manifestEntry = all.find((e) => e.path === MANIFEST_PATH);
  const manifest: ArchiveManifest | null = manifestEntry
    ? JSON.parse(new TextDecoder().decode(manifestEntry.data))
    : null;
  return {
    count: all.filter((e) => e.path !== MANIFEST_PATH).length,
    base: manifest?.base ?? null,
    webId: manifest?.webId ?? null,
  };
}

/**
 * Restore an archive produced by {@link exportArchive} into a Pod. Recreates the
 * needed containers, rebases textual bodies onto the target Pod (rewriting the
 * source WebID and storage root when they differ), then PUTs each resource with
 * its recorded content type. Throws if not logged in or the archive is malformed.
 * @operation mutation
 */
export async function importArchive(
  session: Session,
  zipBytes: Uint8Array,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const { signal, targetBase, targetWebId } = options;
  const webId = session.info.webId;
  if (!webId) throw new Error("Not logged in");
  const root = targetBase ?? appRoot(webId);
  const ownWebId = targetWebId ?? webId;

  const all = readZip(zipBytes);
  const manifestEntry = all.find((e) => e.path === MANIFEST_PATH);
  const manifest: ArchiveManifest | null = manifestEntry
    ? JSON.parse(new TextDecoder().decode(manifestEntry.data))
    : null;
  const files = all.filter((e) => e.path !== MANIFEST_PATH);

  // Term-precise rebase onto the target Pod/identity (Turtle only; see rebaseTurtle).
  const sourceBase = manifest?.base ?? null;
  const sourceWebId = manifest?.webId ?? null;
  const m: RebaseMap = {
    oldWebId: sourceWebId,
    newWebId: ownWebId,
    oldBase: sourceBase,
    newBase: root,
  };
  const doRebase = rebaseNeeded(m);

  // Provision every container in the tree first, shallowest-first, so each PUT
  // lands in an existing parent (CSS won't auto-create intermediate containers).
  // The app collection root itself is no longer a path segment (paths are
  // collection-relative), so ensure it explicitly before the nested ones.
  signal?.throwIfAborted();
  await ensureContainer(root, session);
  const containers = new Set<string>();
  for (const { path } of files) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      containers.add(parts.slice(0, i).join("/") + "/");
    }
  }
  for (const rel of [...containers].sort((a, b) => a.length - b.length)) {
    signal?.throwIfAborted();
    await ensureContainer(root + rel, session);
  }

  let restored = 0;
  for (const { path, data } of files) {
    signal?.throwIfAborted();
    const contentType = manifest?.entries[path] || guessContentType(path);
    // Copy into a standalone buffer: the zip entry is a subarray view into the
    // larger archive, which some fetch impls mishandle as a body. Turtle bodies
    // are rebased term-precisely; everything else is copied verbatim.
    let body: Uint8Array = data.slice();
    if (doRebase && isTurtle(contentType)) {
      const sourceUri = (sourceBase ?? root) + path;
      const text = rebaseTurtle(new TextDecoder().decode(data), sourceUri, m);
      body = new TextEncoder().encode(text);
    }
    const put = await session.fetch(root + path, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: body as unknown as BodyInit,
    });
    if (!put.ok) {
      throw new Error(`Failed to write ${path} (HTTP ${put.status})`);
    }
    restored++;
  }
  return {
    restored,
    rebasedFrom: sourceBase && sourceBase !== root ? sourceBase : null,
    rebasedTo: sourceBase && sourceBase !== root ? root : null,
    rebasedWebId: sourceWebId && sourceWebId !== ownWebId ? ownWebId : null,
  };
}

/** Best-effort content type from a file extension (manifest is the source of truth). */
function guessContentType(path: string): string {
  if (path.endsWith(".ttl")) return "text/turtle";
  if (path.endsWith(".json") || path.endsWith(".jsonld")) return "application/json";
  if (path.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

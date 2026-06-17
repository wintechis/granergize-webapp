import type { PodGateway } from "./pod/podGateway.ts";
import { DataFactory } from "n3";
import { GRAN_NS, RDF_TYPE } from "./rdf/vocabularies.ts";
import { appRoot } from "./pod/solidUtils.ts";
import { readStoreOrEmpty } from "./pod/podFetch.ts";
import { readModifyWrite } from "./pod/podWrite.ts";

const { namedNode } = DataFactory;

const RDF_TYPE_NODE = namedNode(RDF_TYPE);
const GRAN_BOOKMARKS = namedNode(`${GRAN_NS}Bookmarks`);
const GRAN_KNOWN_ROOM = namedNode(`${GRAN_NS}knownRoom`);

/**
 * External rooms you've joined (rooms hosted by others), in a single flat file
 * `bookmarks.ttl` — single writer (you), low contention. The "Your rooms" list.
 * Split out of the old `rooms.ttl`; the active-room pointer lives in `prefs.ts`,
 * and rooms you *host* are discovered by listing `rooms/` (not duplicated here).
 */
export function bookmarksUri(webId: string): string {
  return `${appRoot(webId)}bookmarks.ttl`;
}

/**
 * Bookmarked room IRIs (the "Your rooms" list). Missing file ⇒ `[]`.
 * @operation query
 */
export async function readBookmarks(gateway: PodGateway): Promise<string[]> {
  const webId = gateway.webId;
  if (!webId) return [];
  const uri = bookmarksUri(webId);
  const store = await readStoreOrEmpty(uri, gateway);
  return store.getObjects(namedNode(uri), GRAN_KNOWN_ROOM, null).map((o) =>
    o.value
  );
}

/**
 * Add a room to bookmarks (deduped). No-op (no write) if already present.
 * @operation mutation
 */
export function addBookmark(gateway: PodGateway, room: string): Promise<void> {
  const uri = bookmarksUri(gateway.webId!);
  const self = namedNode(uri);
  const node = namedNode(room);
  return readModifyWrite(uri, gateway, (store) => {
    if (store.getQuads(self, GRAN_KNOWN_ROOM, node, null).length > 0) {
      return false; // already bookmarked → skip the write
    }
    store.addQuad(self, RDF_TYPE_NODE, GRAN_BOOKMARKS);
    store.addQuad(self, GRAN_KNOWN_ROOM, node);
  });
}

/**
 * Remove a room from bookmarks. No-op (no write) if it wasn't bookmarked.
 * @operation mutation
 */
export function removeBookmark(gateway: PodGateway, room: string): Promise<void> {
  const uri = bookmarksUri(gateway.webId!);
  const self = namedNode(uri);
  const node = namedNode(room);
  return readModifyWrite(uri, gateway, (store) => {
    const existing = store.getQuads(self, GRAN_KNOWN_ROOM, node, null);
    if (existing.length === 0) return false;
    store.removeQuads(existing);
  });
}

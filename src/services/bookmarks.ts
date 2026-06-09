import { Session } from "@inrupt/solid-client-authn-browser";
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
export function bookmarksUrl(webId: string): string {
  return `${appRoot(webId)}bookmarks.ttl`;
}

/**
 * Bookmarked room URLs (the "Your rooms" list). Missing file ⇒ `[]`.
 * @operation query
 */
export async function readBookmarks(session: Session): Promise<string[]> {
  const webId = session.info.webId;
  if (!webId) return [];
  const url = bookmarksUrl(webId);
  const store = await readStoreOrEmpty(url, session);
  return store.getObjects(namedNode(url), GRAN_KNOWN_ROOM, null).map((o) =>
    o.value
  );
}

/**
 * Add a room to bookmarks (deduped). No-op (no write) if already present.
 * @operation mutation
 */
export function addBookmark(session: Session, room: string): Promise<void> {
  const url = bookmarksUrl(session.info.webId!);
  const self = namedNode(url);
  const node = namedNode(room);
  return readModifyWrite(url, session, (store) => {
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
export function removeBookmark(session: Session, room: string): Promise<void> {
  const url = bookmarksUrl(session.info.webId!);
  const self = namedNode(url);
  const node = namedNode(room);
  return readModifyWrite(url, session, (store) => {
    const existing = store.getQuads(self, GRAN_KNOWN_ROOM, node, null);
    if (existing.length === 0) return false;
    store.removeQuads(existing);
  });
}

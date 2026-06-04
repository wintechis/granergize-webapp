import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import { GRAN_NS, RDF_TYPE } from "./vocabularies.ts";
import { getStorageRoot } from "./solidUtils.ts";
import { fetchFresh } from "./podFetch.ts";
import { readModifyWrite } from "./podWrite.ts";

const { namedNode } = DataFactory;

const RDF_TYPE_NODE = namedNode(RDF_TYPE);
const GRAN_PREFERENCES = namedNode(`${GRAN_NS}Preferences`);
const GRAN_CURRENT_ROOM = namedNode(`${GRAN_NS}currentRoom`);
const GRAN_HIDDEN_BUILDING = namedNode(`${GRAN_NS}hiddenBuilding`);

/**
 * Personal, low-contention UI state — one small flat file (`prefs.ttl`) you alone
 * write, so read-modify-write is safe. Holds the active room and the buildings
 * you've hidden from your dashboard; room for future UI prefs (last tab, …). This
 * replaces the old `hiddenBuildings.ttl` and the `gran:currentRoom` half of
 * `rooms.ttl`. The room *bookmark* list lives separately in `bookmarks.ts`.
 */
export interface Preferences {
  /** The data room you're currently in (0 or 1). */
  currentRoom: string | null;
  /** Buildings shared with you that you've chosen to hide from the dashboard. */
  hiddenBuildings: Set<string>;
}

/** `<storageRoot>granergize/prefs.ttl` — your personal preferences resource. */
export function prefsUrl(webId: string): string {
  return `${getStorageRoot(webId)}granergize/prefs.ttl`;
}

/** Read `prefs.ttl`. A missing file yields empty prefs (created on first write). */
export async function readPrefs(session: Session): Promise<Preferences> {
  const webId = session.info.webId;
  if (!webId) return { currentRoom: null, hiddenBuildings: new Set() };
  const url = prefsUrl(webId);
  const res = await fetchFresh(url, session);
  if (!res.ok) return { currentRoom: null, hiddenBuildings: new Set() };
  const store = new Store(new Parser({ baseIRI: url }).parse(await res.text()));
  const self = namedNode(url);
  return {
    currentRoom:
      store.getObjects(self, GRAN_CURRENT_ROOM, null)[0]?.value ?? null,
    hiddenBuildings: new Set(
      store.getObjects(self, GRAN_HIDDEN_BUILDING, null)
        .filter((o) => o.termType === "NamedNode")
        .map((o) => o.value),
    ),
  };
}

/**
 * Atomic read-modify-write of `prefs.ttl`. `mutate` touches only its own
 * predicate (leaving the other prefs intact), so the room pointer and the hidden
 * list — written by independent code paths — coexist in one file safely.
 */
function mutatePrefs(
  session: Session,
  mutate: (store: Store, self: ReturnType<typeof namedNode>) => void,
): Promise<void> {
  const url = prefsUrl(session.info.webId!);
  const self = namedNode(url);
  return readModifyWrite(url, session, (store) => {
    store.addQuad(self, RDF_TYPE_NODE, GRAN_PREFERENCES);
    mutate(store, self);
  });
}

/** Set (or clear, with `null`) the current room — replaces any existing pointer. */
export function setCurrentRoom(
  session: Session,
  room: string | null,
): Promise<void> {
  return mutatePrefs(session, (store, self) => {
    store.removeQuads(store.getQuads(self, GRAN_CURRENT_ROOM, null, null));
    if (room) store.addQuad(self, GRAN_CURRENT_ROOM, namedNode(room));
  });
}

/** Flip a building's hidden state (hidden ⇄ visible) in your dashboard. */
export function toggleHiddenBuilding(
  session: Session,
  buildingUri: string,
): Promise<void> {
  const building = namedNode(buildingUri);
  return mutatePrefs(session, (store, self) => {
    const existing = store.getQuads(self, GRAN_HIDDEN_BUILDING, building, null);
    if (existing.length > 0) store.removeQuads(existing); // hidden → visible
    else store.addQuad(self, GRAN_HIDDEN_BUILDING, building); // visible → hidden
  });
}

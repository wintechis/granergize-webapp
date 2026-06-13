import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Store } from "n3";
import { GRAN_NS, RDF_TYPE, XSD_BOOLEAN as XSD_BOOLEAN_IRI } from "./rdf/vocabularies.ts";
import { appRoot } from "./pod/solidUtils.ts";
import { readStoreOrEmpty } from "./pod/podFetch.ts";
import { readModifyWrite } from "./pod/podWrite.ts";

const { namedNode } = DataFactory;

const RDF_TYPE_NODE = namedNode(RDF_TYPE);
const GRAN_PREFERENCES = namedNode(`${GRAN_NS}Preferences`);
const GRAN_CURRENT_ROOM = namedNode(`${GRAN_NS}currentRoom`);
const GRAN_HIDDEN_BUILDING = namedNode(`${GRAN_NS}hiddenBuilding`);
const GRAN_DEMO_SEED_DECLINED = namedNode(`${GRAN_NS}demoSeedDeclined`);
const XSD_BOOLEAN = namedNode(XSD_BOOLEAN_IRI);

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
  /** True once the user dismissed the fresh-Pod "add demo buildings?" offer. */
  demoSeedDeclined: boolean;
}

/** `<storageRoot><APP_DIR>/prefs.ttl` — your personal preferences resource. */
export function prefsUri(webId: string): string {
  return `${appRoot(webId)}prefs.ttl`;
}

/**
 * Read `prefs.ttl`. A missing file yields empty prefs (created on first write).
 * @operation query
 */
export async function readPrefs(session: Session): Promise<Preferences> {
  const webId = session.info.webId;
  const empty: Preferences = {
    currentRoom: null,
    hiddenBuildings: new Set(),
    demoSeedDeclined: false,
  };
  if (!webId) return empty;
  const store = await readStoreOrEmpty(prefsUri(webId), session);
  const self = namedNode(prefsUri(webId));
  return {
    currentRoom:
      store.getObjects(self, GRAN_CURRENT_ROOM, null)[0]?.value ?? null,
    hiddenBuildings: new Set(
      store.getObjects(self, GRAN_HIDDEN_BUILDING, null)
        .filter((o) => o.termType === "NamedNode")
        .map((o) => o.value),
    ),
    demoSeedDeclined:
      store.getObjects(self, GRAN_DEMO_SEED_DECLINED, null)[0]?.value === "true",
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
  const url = prefsUri(session.info.webId!);
  const self = namedNode(url);
  return readModifyWrite(url, session, (store) => {
    store.addQuad(self, RDF_TYPE_NODE, GRAN_PREFERENCES);
    mutate(store, self);
  });
}

/**
 * Set (or clear, with `null`) the current room — replaces any existing pointer.
 * @operation mutation
 */
export function setCurrentRoom(
  session: Session,
  room: string | null,
): Promise<void> {
  return mutatePrefs(session, (store, self) => {
    store.removeQuads(store.getQuads(self, GRAN_CURRENT_ROOM, null, null));
    if (room) store.addQuad(self, GRAN_CURRENT_ROOM, namedNode(room));
  });
}

/**
 * Remember whether the user dismissed the fresh-Pod demo-buildings offer.
 * @operation mutation
 */
export function setDemoSeedDeclined(
  session: Session,
  declined: boolean,
): Promise<void> {
  return mutatePrefs(session, (store, self) => {
    store.removeQuads(store.getQuads(self, GRAN_DEMO_SEED_DECLINED, null, null));
    if (declined) {
      store.addQuad(
        self,
        GRAN_DEMO_SEED_DECLINED,
        DataFactory.literal("true", XSD_BOOLEAN),
      );
    }
  });
}

/**
 * Flip a building's hidden state (hidden ⇄ visible) in your dashboard.
 * @operation mutation
 */
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

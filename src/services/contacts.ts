import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Store } from "n3";
import {
  RDF_TYPE,
  VCARD_ADDRESS_BOOK,
  VCARD_FN,
  VCARD_HAS_MEMBER,
  VCARD_HAS_PHOTO,
  VCARD_INDIVIDUAL,
} from "./rdf/vocabularies.ts";
import { podResources } from "./pod/solidUtils.ts";
import { readStoreOrEmpty } from "./pod/podFetch.ts";
import { readModifyWrite } from "./pod/podWrite.ts";
import { resolveAgent, webIdFragment } from "./agents/agentResolver.ts";
import { logError } from "../lib/logError.ts";

const { namedNode, literal } = DataFactory;

const RDF_TYPE_NODE = namedNode(RDF_TYPE);
const ADDRESS_BOOK = namedNode(VCARD_ADDRESS_BOOK);
const INDIVIDUAL = namedNode(VCARD_INDIVIDUAL);
const HAS_MEMBER = namedNode(VCARD_HAS_MEMBER);
const FN = namedNode(VCARD_FN);
const HAS_PHOTO = namedNode(VCARD_HAS_PHOTO);

/**
 * A locally-remembered agent. The address book is a *cache*, not the source of
 * truth — `name`/`avatarUrl` are the agent's own profile values snapshotted at
 * remember-time (re-resolved live by {@link resolveAgent} where freshness matters).
 */
export interface Contact {
  webId: string;
  name?: string;
  avatarUrl?: string;
}

/** `<storageRoot><APP_DIR>/contacts.ttl` — the personal vCard address book. */
export function contactsUri(webId: string): string {
  return podResources(webId).contacts;
}

/** The `vcard:AddressBook` subject node within the contacts document. */
const bookNode = (url: string) => namedNode(`${url}#book`);

/**
 * Read the address book. Folds `vcard:hasMember` (the WebIDs) with each member's
 * cached `vcard:fn`/`vcard:hasPhoto`. A missing file yields an empty list (created
 * on first {@link addContact}), exactly like {@link readPrefs}.
 * @operation query
 */
export async function readContacts(session: Session): Promise<Contact[]> {
  const webId = session.info.webId;
  if (!webId) return [];
  const url = contactsUri(webId);
  const store = await readStoreOrEmpty(url, session);
  return store.getObjects(bookNode(url), HAS_MEMBER, null)
    .filter((m) => m.termType === "NamedNode")
    .map((m) => {
      const subject = namedNode(m.value);
      const name = store.getObjects(subject, FN, null)[0]?.value;
      const avatarUrl = store.getObjects(subject, HAS_PHOTO, null)[0]?.value;
      return {
        webId: m.value,
        ...(name ? { name } : {}),
        ...(avatarUrl ? { avatarUrl } : {}),
      };
    });
}

/**
 * Atomic read-modify-write of `contacts.ttl`. `mutate` touches only the address
 * book + the one member it concerns, leaving other contacts intact.
 */
function mutateContacts(
  session: Session,
  mutate: (store: Store, book: ReturnType<typeof namedNode>) => void,
): Promise<void> {
  const url = contactsUri(session.info.webId!);
  const book = bookNode(url);
  return readModifyWrite(url, session, (store) => {
    store.addQuad(book, RDF_TYPE_NODE, ADDRESS_BOOK);
    mutate(store, book);
  });
}

/**
 * Add (or update) a contact. Idempotent: re-adding the same WebID replaces its
 * cached name/photo rather than duplicating — so auto-remember can fire freely.
 * @operation mutation
 */
export function addContact(
  session: Session,
  contact: Contact,
): Promise<void> {
  const subject = namedNode(contact.webId);
  return mutateContacts(session, (store, book) => {
    store.addQuad(book, HAS_MEMBER, subject);
    store.addQuad(subject, RDF_TYPE_NODE, INDIVIDUAL);
    store.removeQuads(store.getQuads(subject, FN, null, null));
    if (contact.name) store.addQuad(subject, FN, literal(contact.name));
    store.removeQuads(store.getQuads(subject, HAS_PHOTO, null, null));
    if (contact.avatarUrl) {
      store.addQuad(subject, HAS_PHOTO, namedNode(contact.avatarUrl));
    }
  });
}

/**
 * Remove a contact: drops its membership and cached vCard fields.
 * @operation mutation
 */
export function removeContact(
  session: Session,
  webId: string,
): Promise<void> {
  const subject = namedNode(webId);
  return mutateContacts(session, (store, book) => {
    store.removeQuads(store.getQuads(book, HAS_MEMBER, subject, null));
    store.removeQuads(store.getQuads(subject, null, null, null));
  });
}

/**
 * Auto-remember a referenced agent: write the contact NOW with the WebID's fragment
 * name, then upgrade it with the resolved `foaf:name`/avatar in the BACKGROUND.
 *
 * The split matters: resolving reads the agent's own profile, and an unreachable or
 * slow host makes that fetch retry (transient-error backoff) for many seconds —
 * blocking the contact's appearance if we awaited it. Writing the cache entry first
 * (no network) makes the contact show immediately and resilient to a dead operator
 * WebID; the resolve then refines the name when (if) the profile answers.
 *
 * Best-effort (the book is only a cache) — failures are swallowed — and idempotent
 * (upsert by WebID), so it can fire-and-forget after every share / operatedBy save.
 * A non-IRI value (a free-text operator name, not a WebID) is ignored. The returned
 * promise settles after the immediate write, NOT the background upgrade — so a
 * caller can invalidate its contacts query and see the entry right away.
 * @operation mutation
 */
export async function rememberAgent(
  session: Session,
  webId: string,
): Promise<void> {
  if (!/^https?:\/\//.test(webId)) return;
  try {
    await addContact(session, { webId, name: webIdFragment(webId) });
  } catch (err) {
    logError("remember agent in contacts cache", err);
    return; // couldn't even write the cache entry — nothing to upgrade
  }
  // Background: refine the name/avatar from the agent's profile if it resolves.
  void resolveAgent(webId, session)
    .then((resolved) => addContact(session, resolved))
    .catch((err) => logError("upgrade remembered agent profile", err));
}

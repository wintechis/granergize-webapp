import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import {
  RDF_TYPE,
  VCARD_ADDRESS_BOOK,
  VCARD_FN,
  VCARD_HAS_MEMBER,
  VCARD_HAS_PHOTO,
  VCARD_INDIVIDUAL,
} from "./vocabularies.ts";
import { podResources } from "./solidUtils.ts";
import { fetchFresh } from "./podFetch.ts";
import { readModifyWrite } from "./podWrite.ts";
import { resolveAgent } from "./agentResolver.ts";
import { logError } from "./logError.ts";

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
export function contactsUrl(webId: string): string {
  return podResources(webId).contacts;
}

/** The `vcard:AddressBook` subject node within the contacts document. */
const bookNode = (url: string) => namedNode(`${url}#book`);

/**
 * Read the address book. Folds `vcard:hasMember` (the WebIDs) with each member's
 * cached `vcard:fn`/`vcard:hasPhoto`. A missing file yields an empty list (created
 * on first {@link addContact}), exactly like {@link readPrefs}.
 */
export async function readContacts(session: Session): Promise<Contact[]> {
  const webId = session.info.webId;
  if (!webId) return [];
  const url = contactsUrl(webId);
  const res = await fetchFresh(url, session);
  if (!res.ok) return [];
  const store = new Store(new Parser({ baseIRI: url }).parse(await res.text()));
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
  const url = contactsUrl(session.info.webId!);
  const book = bookNode(url);
  return readModifyWrite(url, session, (store) => {
    store.addQuad(book, RDF_TYPE_NODE, ADDRESS_BOOK);
    mutate(store, book);
  });
}

/**
 * Add (or update) a contact. Idempotent: re-adding the same WebID replaces its
 * cached name/photo rather than duplicating — so auto-remember can fire freely.
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

/** Remove a contact: drops its membership and cached vCard fields. */
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
 * Auto-remember a referenced agent: resolve its name/avatar then upsert a contact.
 * Best-effort (the book is only a cache) — failures are swallowed — and idempotent,
 * so it can fire-and-forget after every share / operatedBy save. A non-IRI value
 * (a free-text operator name, not a WebID) is ignored.
 */
export async function rememberAgent(
  session: Session,
  webId: string,
): Promise<void> {
  if (!/^https?:\/\//.test(webId)) return;
  try {
    await addContact(session, await resolveAgent(webId, session));
  } catch (err) {
    logError("remember agent in contacts cache", err);
    // best-effort cache; ignore
  }
}

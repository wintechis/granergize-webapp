// Intent core (React-free) for SaveContact. See ./README.md for the core/adapter
// split and the write→outcome convention. A plain in-place write → {@link Settled}.
import type { Session } from "@inrupt/solid-client-authn-browser";
import { addContact, type Contact } from "../services/contacts.ts";
import type { Settled } from "./outcomes.ts";

/** Parameters of the SaveContact intent. */
export interface SaveContactParams {
  /** The contact to add or update in the address book (opaque, not an IRI to resolve). */
  contact: Contact;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useSaveContact}:
 * add (or update) a contact in the address book. A plain write — the hook is a
 * thin adapter owning only the `contacts` invalidation. Takes `session` as an
 * argument — no `getSession()`, no React — so it is callable headless.
 */
export async function saveContactCore(
  session: Session,
  params: SaveContactParams,
): Promise<Settled> {
  await addContact(session, params.contact);
  return { ok: true };
}

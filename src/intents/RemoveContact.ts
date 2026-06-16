// Intent core (React-free) for RemoveContact. See ./README.md. A plain in-place
// write → {@link Settled}.
import type { Session } from "@inrupt/solid-client-authn-browser";
import { removeContact } from "../services/contacts.ts";
import type { Settled } from "./outcomes.ts";

/** Parameters of the RemoveContact intent. */
export interface RemoveContactParams {
  /** The contact's WebID to drop from the address book. */
  webId: string;
}

/**
 * React-free core of {@link import("../hooks/mutations.ts").useRemoveContact}:
 * remove a contact from the address book. A plain write — the hook is a thin
 * adapter owning only the `contacts` invalidation. Takes `session` as an
 * argument — no `getSession()`, no React — so it is callable headless.
 */
export async function removeContactCore(
  session: Session,
  params: RemoveContactParams,
): Promise<Settled> {
  await removeContact(session, params.webId);
  return { ok: true };
}

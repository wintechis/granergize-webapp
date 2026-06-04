import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory } from "n3";
import { loadProfileStore } from "./profileDocument.ts";
import { FOAF_NS, VCARD_NS } from "./vocabularies.ts";

/**
 * Reads the logged-in person's avatar from their WebID profile.
 *
 * This is the *personal* depiction, distinct from the organisation's logo
 * (see organizationManager.ts, which writes foaf:logo on a <#org> node). We read
 * foaf:img first — a personal logo other Solid tools may set — then fall back to
 * vcard:hasPhoto, the profile photo an identity provider commonly populates.
 *
 * Read-only: the app no longer writes a personal logo (the upload now targets the
 * organisation). Reads go through session.fetch so it works on private Pods.
 */

const FOAF_IMG = `${FOAF_NS}img`;
const VCARD_HAS_PHOTO = `${VCARD_NS}hasPhoto`;

/** Person-depiction predicates, in preference order. */
const AVATAR_PREDICATES = [FOAF_IMG, VCARD_HAS_PHOTO];

/**
 * The avatar image URL for the person, or null if none. Prefers foaf:img, then
 * falls back to a profile photo (vcard:hasPhoto).
 */
export async function getAvatarUrl(session: Session): Promise<string | null> {
  const webId = session.info.webId;
  if (!webId) return null;

  const store = await loadProfileStore(session);
  if (!store) return null;

  const subject = DataFactory.namedNode(webId);
  for (const pred of AVATAR_PREDICATES) {
    const quads = store.getQuads(subject, DataFactory.namedNode(pred), null, null);
    if (quads.length > 0) return quads[0].object.value;
  }
  return null;
}

/**
 * Fetch the avatar (logo or profile photo) as an object URL for an <img src>,
 * or null. The caller revokes the returned URL when done.
 */
export async function getAvatarObjectUrl(
  session: Session,
): Promise<string | null> {
  const url = await getAvatarUrl(session);
  if (!url) return null;
  try {
    const res = await session.fetch(url);
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}

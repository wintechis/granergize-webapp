import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Store } from "n3";
import { putAcl, readModifyWrite } from "../pod/podWrite.ts";
import { invalidateProfile, loadProfileStore } from "../pod/profileDocument.ts";
import { getPodBaseUri } from "../pod/solidUtils.ts";
import { logError } from "../../lib/logError.ts";
import {
  FOAF_LOGO,
  FOAF_NS,
  ORG_MEMBER_OF,
  ORG_NS,
  OWL_NS,
  RDF_TYPE,
} from "../rdf/vocabularies.ts";

/**
 * The organisation the logged-in user works for, stored *inline in the WebID
 * document* (`card`) as a `<#org>` node and linked from the person via
 * `org:memberOf` (W3C Org ontology). FOAF carries the org's name/logo/homepage:
 *
 *   <#me>  a foaf:Person ; org:memberOf <#org> ; org:hasMembership <#membership> .
 *   <#membership> a org:Membership ;          # the person↔org link, role-free
 *          org:member <#me> ; org:organization <#org> .
 *   <#org> a org:Organization, foaf:Organization ;
 *          foaf:name "ACME" ; foaf:logo <…/logo.png> ;
 *          foaf:homepage <https://acme.example/> ;
 *          owl:sameAs <https://acme.example/profile/card#me> .  # org's own WebID
 *
 * The membership is role-free (no `org:role`) and the org node carries only FOAF
 * identity. A user's role exists only inside a data room and is the role of THIS
 * org, held via the user (see notes/room.md); it is not recorded on the profile.
 *
 * The logo *image* lives at `<pod>/profile/logo.<ext>` (in the profile folder,
 * since the org is part of the profile); only the link (`foaf:logo` on `<#org>`)
 * is what we rewrite here. Profile writes are in-place mutations through
 * the shared {@link readModifyWrite} (GET → mutate → conditional PUT with
 * If-Match, the server ignores PATCH); a missing profile document is an error,
 * never silently created.
 */

const ORG_ORGANIZATION = `${ORG_NS}Organization`;
const FOAF_ORGANIZATION = `${FOAF_NS}Organization`;
const FOAF_NAME = `${FOAF_NS}name`;
const FOAF_HOMEPAGE = `${FOAF_NS}homepage`;
const OWL_SAME_AS = `${OWL_NS}sameAs`;
// W3C Org membership — the role-free person↔org link (no org:role). A user's role
// lives only in a data room and is the role of this org, held via the user.
const ORG_HAS_MEMBERSHIP = `${ORG_NS}hasMembership`;
const ORG_MEMBERSHIP = `${ORG_NS}Membership`;
const ORG_MEMBER = `${ORG_NS}member`;
// The `org:organization` PROPERTY (lowercase) linking a Membership to its org —
// distinct from `ORG_ORGANIZATION` above, which is the `org:Organization` CLASS.
const ORG_ORGANIZATION_PRED = `${ORG_NS}organization`;

export interface Organization {
  /** Display name (foaf:name). */
  name?: string;
  /** Logo image URL (foaf:logo). */
  logoUrl?: string;
  /** Homepage URL (foaf:homepage). */
  homepage?: string;
  /** The organisation's own WebID/IRI, if any (owl:sameAs). */
  sameAs?: string;
}

/** image/* MIME → file extension for the stored logo. */
const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function isSupportedLogoType(file: File): boolean {
  return file.type in EXT_BY_MIME;
}

/** The WebID document URL (the WebID without its `#me` fragment). */
function profileDocUri(webId: string): string {
  return webId.split("#")[0];
}

/** The inline org node IRI for this profile (`<…/card#org>`). */
function orgNodeIri(webId: string): string {
  return `${profileDocUri(webId)}#org`;
}

/** The inline org-membership node IRI for this profile (`<…/card#membership>`). */
function membershipNodeIri(webId: string): string {
  return `${profileDocUri(webId)}#membership`;
}

/** First object value for (subject, predicate), or undefined. */
function firstObject(
  store: Store,
  subject: string,
  predicate: string,
): string | undefined {
  const quads = store.getQuads(
    DataFactory.namedNode(subject),
    DataFactory.namedNode(predicate),
    null,
    null,
  );
  return quads.length > 0 ? quads[0].object.value : undefined;
}

/**
 * Read the user's organisation from the WebID profile, or null if none is set.
 * Follows `org:memberOf` to the org node and reads its FOAF fields.
 * @operation query
 */
export async function getOrganization(
  session: Session,
): Promise<Organization | null> {
  const webId = session.info.webId;
  if (!webId) return null;
  const store = await loadProfileStore(session);
  if (!store) return null;

  const orgIri = firstObject(store, webId, ORG_MEMBER_OF);
  if (!orgIri) return null;

  const org: Organization = {
    name: firstObject(store, orgIri, FOAF_NAME),
    logoUrl: firstObject(store, orgIri, FOAF_LOGO),
    homepage: firstObject(store, orgIri, FOAF_HOMEPAGE),
    sameAs: firstObject(store, orgIri, OWL_SAME_AS),
  };
  return org;
}

/**
 * Fetch the org logo as an object URL for an <img src>, or null.
 * @operation query
 */
export async function getOrgLogoObjectUrl(
  session: Session,
): Promise<string | null> {
  const org = await getOrganization(session);
  if (!org?.logoUrl) return null;
  try {
    const res = await session.fetch(org.logoUrl);
    if (!res.ok) return null;
    return URL.createObjectURL(await res.blob());
  } catch (err) {
    logError("fetch org logo object URL", err);
    return null;
  }
}

/** Remove every (subject, predicate, *) quad from the store. */
function clearPredicate(store: Store, subject: string, predicate: string): void {
  for (
    const q of store.getQuads(
      DataFactory.namedNode(subject),
      DataFactory.namedNode(predicate),
      null,
      null,
    )
  ) {
    store.removeQuad(q);
  }
}

/** Set a single named-node object for (subject, predicate), replacing any prior. */
function setNamedNode(
  store: Store,
  subject: string,
  predicate: string,
  object: string,
): void {
  clearPredicate(store, subject, predicate);
  store.addQuad(
    DataFactory.namedNode(subject),
    DataFactory.namedNode(predicate),
    DataFactory.namedNode(object),
  );
}

/** Set a single literal object for (subject, predicate), replacing any prior. */
function setLiteral(
  store: Store,
  subject: string,
  predicate: string,
  value: string,
): void {
  clearPredicate(store, subject, predicate);
  store.addQuad(
    DataFactory.namedNode(subject),
    DataFactory.namedNode(predicate),
    DataFactory.literal(value),
  );
}

/** Ensure (subject, rdf:type, type) is present without removing other types. */
function ensureType(store: Store, subject: string, type: string): void {
  const has = store.getQuads(
    DataFactory.namedNode(subject),
    DataFactory.namedNode(RDF_TYPE),
    DataFactory.namedNode(type),
    null,
  ).length > 0;
  if (!has) {
    store.addQuad(
      DataFactory.namedNode(subject),
      DataFactory.namedNode(RDF_TYPE),
      DataFactory.namedNode(type),
    );
  }
}

/**
 * Ensure the role-free W3C Org skeleton: `<#me> org:memberOf <#org>`, the org
 * node's `org:Organization`/`foaf:Organization` types, and a membership
 * (`<#me> org:hasMembership <#membership>` → `<#membership> a org:Membership ;
 * org:member <#me> ; org:organization <#org>`). The FOAF identity fields are set
 * by the callers; this only wires the role-free person↔org link.
 */
function ensureOrgMembership(store: Store, webId: string): void {
  const org = orgNodeIri(webId);
  setNamedNode(store, webId, ORG_MEMBER_OF, org);
  ensureType(store, org, ORG_ORGANIZATION);
  ensureType(store, org, FOAF_ORGANIZATION);

  const membership = membershipNodeIri(webId);
  setNamedNode(store, webId, ORG_HAS_MEMBERSHIP, membership);
  ensureType(store, membership, ORG_MEMBERSHIP);
  setNamedNode(store, membership, ORG_MEMBER, webId);
  setNamedNode(store, membership, ORG_ORGANIZATION_PRED, org);
}

/**
 * Apply `edit` to the WebID profile document via the shared conditional
 * read-modify-write (If-Match optimistic locking). The profile must already
 * exist — a 404 throws instead of silently creating a profile document.
 * On success the shared profile cache is dropped so the next read (org panel,
 * avatar) sees the new state instead of the stale Store.
 */
async function mutateProfile(
  docUri: string,
  session: Session,
  edit: (store: Store) => void,
): Promise<void> {
  await readModifyWrite(docUri, session, (store, { created }) => {
    if (created) {
      // A WebID profile is provisioned by the identity provider, never by us.
      throw new Error(`Failed to fetch WebID profile at ${docUri}: Not Found`);
    }
    edit(store);
  });
  invalidateProfile(session.info.webId ?? undefined);
}

/**
 * Save the user's organisation fields into the WebID profile (single PUT).
 * Ensures `<#me> org:memberOf <#org>` and the org node's type; replaces the
 * scalar fields (no duplicates); blank fields are cleared. An existing
 * `foaf:logo` is preserved (managed separately by {@link uploadOrgLogo}).
 * @operation mutation
 */
export async function saveOrganization(
  session: Session,
  fields: Pick<Organization, "name" | "homepage" | "sameAs">,
): Promise<void> {
  const webId = session.info.webId;
  if (!session.info.isLoggedIn || !webId) {
    throw new Error("User is not logged in");
  }
  const docUri = profileDocUri(webId);
  const org = orgNodeIri(webId);
  const name = fields.name?.trim();
  const homepage = fields.homepage?.trim();
  const sameAs = fields.sameAs?.trim();

  await mutateProfile(docUri, session, (store) => {
    ensureOrgMembership(store, webId);
    if (name) setLiteral(store, org, FOAF_NAME, name);
    else clearPredicate(store, org, FOAF_NAME);
    if (homepage) setNamedNode(store, org, FOAF_HOMEPAGE, homepage);
    else clearPredicate(store, org, FOAF_HOMEPAGE);
    if (sameAs) setNamedNode(store, org, OWL_SAME_AS, sameAs);
    else clearPredicate(store, org, OWL_SAME_AS);
  });
}

/**
 * Upload an image as the organisation's logo and link it via `foaf:logo` on the
 * `<#org>` node (creating the membership/type if absent). Returns the logo URL.
 * @operation mutation
 */
export async function uploadOrgLogo(
  file: File,
  session: Session,
): Promise<string> {
  const webId = session.info.webId;
  if (!session.info.isLoggedIn || !webId) {
    throw new Error("User is not logged in");
  }
  const ext = EXT_BY_MIME[file.type];
  if (!ext) {
    throw new Error(`Unsupported image type: ${file.type || "unknown"}`);
  }

  // 1. Store the image in the profile folder, alongside the WebID document — the
  //    org is part of the profile (the inline <#org> node in card), so its logo
  //    lives in profile/, not under the app's granergize/ tree.
  const logoUrl = `${getPodBaseUri(webId)}logo.${ext}`;
  const put = await session.fetch(logoUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!put.ok) {
    throw new Error(`Failed to upload logo to ${logoUrl}: ${put.statusText}`);
  }

  // 2. Make the logo world-readable via its own `.acl`: the logo is consumed
  //    cross-agent by plain `<img>` loads — the map's producer-logo markers
  //    resolve it on OTHER users' maps (and even the owner's own marker `<img>`
  //    goes out unauthenticated). Without this, a default-private Pod serves
  //    the logo only to its owner's authed fetches and every marker falls back
  //    to the default pin. Best-effort: a non-WAC pod rejects the `.acl` PUT
  //    without breaking the upload; there the provider's profile-folder
  //    defaults decide visibility.
  const acl = `@prefix acl: <http://www.w3.org/ns/auth/acl#>.
@prefix foaf: <http://xmlns.com/foaf/0.1/>.
<#public> a acl:Authorization; acl:accessTo <${logoUrl}>;
  acl:agentClass foaf:Agent; acl:mode acl:Read.
<#owner> a acl:Authorization; acl:accessTo <${logoUrl}>;
  acl:agent <${webId}>; acl:mode acl:Read, acl:Write, acl:Control.
`;
  await putAcl(`${logoUrl}.acl`, acl, session)
    .catch((err) => logError("publish org logo ACL", err));

  // 3. Link it as foaf:logo on the org node (conditional GET → rewrite → PUT).
  const docUri = profileDocUri(webId);
  const org = orgNodeIri(webId);
  await mutateProfile(docUri, session, (store) => {
    ensureOrgMembership(store, webId);
    setNamedNode(store, org, FOAF_LOGO, logoUrl);
  });
  return logoUrl;
}

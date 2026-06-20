import type { PodGateway } from "../pod/podGateway.ts";
import { DataFactory, Store } from "n3";
import { loadProfileStoreFor } from "../pod/profileDocument.ts";
import { logError } from "../../lib/logError.ts";
import { trackedFetch } from "../../lib/networkActivity.ts";
import { fetchWikidataLogo } from "./wikidataLogo.ts";
import {
  FOAF_HOMEPAGE,
  FOAF_IMG,
  FOAF_LOGO,
  FOAF_MBOX,
  FOAF_NAME,
  ORG_MEMBER_OF,
  OWL_SAME_AS,
  VCARD_COUNTRY_NAME,
  VCARD_FN,
  VCARD_HAS_ADDRESS,
  VCARD_HAS_EMAIL,
  VCARD_HAS_PHOTO,
  VCARD_HAS_TELEPHONE,
  VCARD_HAS_URL,
  VCARD_LOCALITY,
  VCARD_POSTAL_CODE,
  VCARD_STREET_ADDRESS,
} from "../rdf/vocabularies.ts";

/**
 * A WebID agent resolved against its own profile document. An agent's profile is
 * not ours to own — its facts live on the agent's Pod (or a Linked-Data wrapper) —
 * so this only *reads* them. Every field is absent when the profile is private,
 * unreachable, or simply doesn't state it.
 *
 * `name`/`avatarUrl` are the identity; `address`/`email`/`phone`/`website` are the
 * read-only **contact facts** the contact page surfaces so the profile shows what
 * the dereferenced document actually holds, rather than only an opaque IRI.
 */
export interface ResolvedAgent {
  webId: string;
  name?: string;
  avatarUrl?: string;
  /** One-line postal address assembled from the `vcard:hasAddress` node. */
  address?: string;
  email?: string;
  phone?: string;
  website?: string;
}

const { namedNode } = DataFactory;

/** First object value for subject+predicate, or undefined. */
function firstObject(
  store: Store,
  subject: string,
  predicate: string,
): string | undefined {
  const quads = store.getQuads(
    namedNode(subject),
    namedNode(predicate),
    null,
    null,
  );
  return quads.length > 0 ? quads[0].object.value : undefined;
}

/** All object values for subject+predicate (insertion order). */
function objects(store: Store, subject: string, predicate: string): string[] {
  return store
    .getQuads(namedNode(subject), namedNode(predicate), null, null)
    .map((q) => q.object.value);
}

/**
 * First object whose predicate IRI *ends with* `suffix`, for the subject. Used for
 * the MaStR wrapper's contact predicates (`…/mastr#Email` etc.), which it serves
 * under its own namespace instead of standard `vcard:`/`foaf:` — and whose relative
 * form resolves unpredictably against the document base, so a suffix match is the
 * robust read (mirrors `mastrNearby.ts`). Remove once the wrapper emits standard
 * vCard/FOAF terms (see plans/stumble.md).
 */
function firstObjectBySuffix(
  store: Store,
  subject: string,
  suffix: string,
): string | undefined {
  for (const q of store.getQuads(namedNode(subject), null, null, null)) {
    if (q.predicate.value.endsWith(suffix)) return q.object.value;
  }
  return undefined;
}

/** Strip a leading `mailto:` so the value displays as a bare address. */
function bareEmail(value?: string): string | undefined {
  return value?.replace(/^mailto:/, "");
}

/**
 * Assemble a one-line postal address from an agent's `vcard:hasAddress` node:
 * "street, postcode locality, country", omitting absent parts. Returns undefined
 * when the agent states no address.
 */
function readAddress(store: Store, subject: string): string | undefined {
  // The address node is typically a blank node, so query it by its term (not by a
  // reconstructed NamedNode, which never matches a BlankNode subject).
  const node = store.getQuads(namedNode(subject), namedNode(VCARD_HAS_ADDRESS), null, null)[0]
    ?.object;
  if (!node) return undefined;
  const part = (predicate: string) =>
    store.getQuads(node, namedNode(predicate), null, null)[0]?.object.value;
  const street = part(VCARD_STREET_ADDRESS);
  const postcode = part(VCARD_POSTAL_CODE);
  const locality = part(VCARD_LOCALITY);
  const country = part(VCARD_COUNTRY_NAME);
  const cityLine = [postcode, locality].filter(Boolean).join(" ");
  const parts = [street, cityLine, country].filter((p) => p && p.length > 0);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

/** The local name of a WebID (fragment after `#`, else the last path segment). */
export function webIdFragment(webId: string): string {
  const hash = webId.split("#")[1];
  if (hash) return hash;
  const path = webId.split("/").filter(Boolean);
  return path[path.length - 1] ?? webId;
}

/**
 * Resolve a WebID to a display name + avatar by reading the agent's own profile.
 * Name = `foaf:name` (preferred) or `vcard:fn`, falling back to the WebID fragment
 * (today's bare-`#me` behaviour). Avatar = `foaf:img` or `vcard:hasPhoto`.
 * Unreachable/private profiles resolve to `{ webId }` (with the fragment name) —
 * resolution never throws, so callers can render references unconditionally.
 * @operation query
 */
export async function resolveAgent(
  webId: string,
  gateway: PodGateway,
): Promise<ResolvedAgent> {
  const fallbackName = webIdFragment(webId);
  let store: Store | null;
  try {
    store = await loadProfileStoreFor(webId, gateway);
  } catch (err) {
    logError("load agent profile for resolution", err);
    store = null;
  }
  if (!store) return { webId, name: fallbackName };

  const name = firstObject(store, webId, FOAF_NAME) ??
    firstObject(store, webId, VCARD_FN) ?? fallbackName;
  const avatarUrl = firstObject(store, webId, FOAF_IMG) ??
    firstObject(store, webId, VCARD_HAS_PHOTO);

  // Contact facts: standard vCard/FOAF first, then the MaStR wrapper's own
  // predicates as a fallback (it emits #Email/#Telefon/#Webseite, not vcard:*).
  const address = readAddress(store, webId);
  const email = bareEmail(
    firstObject(store, webId, VCARD_HAS_EMAIL) ??
      firstObject(store, webId, FOAF_MBOX) ??
      firstObjectBySuffix(store, webId, "#Email"),
  );
  const phone = firstObject(store, webId, VCARD_HAS_TELEPHONE) ??
    firstObjectBySuffix(store, webId, "#Telefon");
  const website = firstObject(store, webId, FOAF_HOMEPAGE) ??
    firstObject(store, webId, VCARD_HAS_URL) ??
    firstObjectBySuffix(store, webId, "#Webseite");

  return {
    webId,
    name,
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(address ? { address } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(website ? { website } : {}),
  };
}

/**
 * An agent's organisation resolved from its own profile: the `org:memberOf`
 * node's `foaf:name` and `foaf:logo`. Either may be absent (a logo-less or
 * name-less org); the logo image itself is a separate world-readable resource.
 */
export interface ResolvedOrg {
  name?: string;
  logoUrl?: string;
  /** Where the logo came from: `"commons"` (Wikidata → Wikimedia Commons, which
   *  needs attribution) vs `"uploaded"` (the org's own `foaf:logo`). */
  logoSource?: "uploaded" | "commons";
}

/**
 * Resolve a WebID to its organisation (name + logo IRI) by reading the agent's
 * own profile: follow `org:memberOf` to the org node, then read its
 * `foaf:name`/`foaf:logo`. When the org node states no `foaf:logo`, fall back to
 * its `owl:sameAs` links — for the first that resolves to a Wikidata entity, use
 * that entity's logo (P154/P18) rendered through Commons. Serves *arbitrary*
 * producers (e.g. a building's `attributedTo`), unlike the self-only
 * `organizationManager`. Returns `null` when the profile is unreachable/private
 * or states no org — never throws, so the map can fall back to a default marker
 * unconditionally. The Wikidata fetch is a public (non-Pod) request, so it goes
 * through the tracked external fetch; tests inject a fake `fetchFn`.
 * @operation query
 */
export async function resolveAgentOrg(
  webId: string,
  gateway: PodGateway,
  fetchFn: typeof fetch = trackedFetch,
): Promise<ResolvedOrg | null> {
  let store: Store | null;
  try {
    store = await loadProfileStoreFor(webId, gateway);
  } catch (err) {
    logError("load agent profile for org resolution", err);
    store = null;
  }
  if (!store) return null;

  const org = firstObject(store, webId, ORG_MEMBER_OF);
  if (!org) return null;
  const name = firstObject(store, org, FOAF_NAME);

  // A profile-stated foaf:logo wins; otherwise try the org's Wikidata sameAs.
  let logoUrl = firstObject(store, org, FOAF_LOGO);
  if (!logoUrl) {
    for (const sameAs of objects(store, org, OWL_SAME_AS)) {
      const fromWikidata = await fetchWikidataLogo(sameAs, fetchFn);
      if (fromWikidata) {
        logoUrl = fromWikidata;
        break;
      }
    }
  }
  // A logo served from Wikimedia Commons (the persisted Commons URL or the
  // render-time Wikidata fallback) is the attribution-bearing case.
  const logoSource: ResolvedOrg["logoSource"] = logoUrl
    ? (logoUrl.includes("commons.wikimedia.org") ? "commons" : "uploaded")
    : undefined;
  return {
    ...(name ? { name } : {}),
    ...(logoUrl ? { logoUrl } : {}),
    ...(logoSource ? { logoSource } : {}),
  };
}

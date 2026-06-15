import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Store } from "n3";
import { loadProfileStoreFor } from "../pod/profileDocument.ts";
import { logError } from "../../lib/logError.ts";
import { trackedFetch } from "../../lib/networkActivity.ts";
import { fetchWikidataLogo } from "./wikidataLogo.ts";
import {
  FOAF_IMG,
  FOAF_LOGO,
  FOAF_NAME,
  ORG_MEMBER_OF,
  OWL_SAME_AS,
  VCARD_FN,
  VCARD_HAS_PHOTO,
} from "../rdf/vocabularies.ts";

/**
 * A WebID agent resolved against its own profile document. An agent's profile is
 * not ours to own — `foaf:name`/`vcard:fn` and `foaf:img`/`vcard:hasPhoto` live on
 * the agent's Pod — so this only *reads* them. `name`/`avatarUrl` are absent when
 * the profile is private, unreachable, or simply doesn't state them.
 */
export interface ResolvedAgent {
  webId: string;
  name?: string;
  avatarUrl?: string;
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
  session: Session,
): Promise<ResolvedAgent> {
  const fallbackName = webIdFragment(webId);
  let store: Store | null;
  try {
    store = await loadProfileStoreFor(webId, session);
  } catch (err) {
    logError("load agent profile for resolution", err);
    store = null;
  }
  if (!store) return { webId, name: fallbackName };

  const name = firstObject(store, webId, FOAF_NAME) ??
    firstObject(store, webId, VCARD_FN) ?? fallbackName;
  const avatarUrl = firstObject(store, webId, FOAF_IMG) ??
    firstObject(store, webId, VCARD_HAS_PHOTO);
  return { webId, name, ...(avatarUrl ? { avatarUrl } : {}) };
}

/**
 * An agent's organisation resolved from its own profile: the `org:memberOf`
 * node's `foaf:name` and `foaf:logo`. Either may be absent (a logo-less or
 * name-less org); the logo image itself is a separate world-readable resource.
 */
export interface ResolvedOrg {
  name?: string;
  logoUrl?: string;
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
  session: Session,
  fetchFn: typeof fetch = trackedFetch,
): Promise<ResolvedOrg | null> {
  let store: Store | null;
  try {
    store = await loadProfileStoreFor(webId, session);
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
  return { ...(name ? { name } : {}), ...(logoUrl ? { logoUrl } : {}) };
}

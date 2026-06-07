import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Store } from "n3";
import { loadProfileStoreFor } from "./profileDocument.ts";
import {
  FOAF_IMG,
  FOAF_NAME,
  VCARD_FN,
  VCARD_HAS_PHOTO,
} from "./vocabularies.ts";

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

/** The local name of a WebID (fragment after `#`, else the last path segment). */
function webIdFragment(webId: string): string {
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
 */
export async function resolveAgent(
  webId: string,
  session: Session,
): Promise<ResolvedAgent> {
  const fallbackName = webIdFragment(webId);
  let store: Store | null = null;
  try {
    store = await loadProfileStoreFor(webId, session);
  } catch {
    store = null;
  }
  if (!store) return { webId, name: fallbackName };

  const name = firstObject(store, webId, FOAF_NAME) ??
    firstObject(store, webId, VCARD_FN) ?? fallbackName;
  const avatarUrl = firstObject(store, webId, FOAF_IMG) ??
    firstObject(store, webId, VCARD_HAS_PHOTO);
  return { webId, name, ...(avatarUrl ? { avatarUrl } : {}) };
}

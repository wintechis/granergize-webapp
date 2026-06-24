import type { PodGateway } from "../pod/podGateway.ts";
import { DataFactory, Parser, Store } from "n3";
import { loadProfileStoreFor } from "../pod/profileDocument.ts";
import { logError } from "../../lib/logError.ts";
import { trackedFetch } from "../../lib/networkActivity.ts";
import { fetchWikidataLogo, wikidataEntityId } from "./wikidataLogo.ts";
import {
  FOAF_HOMEPAGE,
  FOAF_IMG,
  FOAF_LOGO,
  FOAF_MBOX,
  FOAF_NAME,
  ORG_MEMBER_OF,
  OWL_SAME_AS,
  RDF_TYPE,
  RDFS_LABEL,
  SCHEMA_NAME,
  SKOS_PREF_LABEL,
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
  WD_IMAGE,
  WD_LOGO,
} from "../rdf/vocabularies.ts";

/**
 * A WebID agent resolved against its own profile document. An agent's profile is
 * not ours to own — its facts live on the agent's Pod (or a Linked-Data wrapper) —
 * so this only *reads* them. Every field is absent when the profile is private,
 * unreachable, or simply doesn't state it.
 *
 * `name`/`avatarUrl` are the identity; `address`/`email`/`phone`/`website` are the
 * read-only **contact facts** the agent page surfaces so the profile shows what
 * the dereferenced document actually holds, rather than only an opaque IRI.
 */
export interface ResolvedAgent {
  webId: string;
  name?: string;
  avatarUrl?: string;
  /**
   * Whether the agent's own profile types it as a person or an organisation
   * (read from `rdf:type`: `foaf:Person`/`vcard:Individual` → person,
   * `foaf:Organization`/`vcard:Organization`/`org:Organization` → organisation).
   * Undefined when the profile is unreachable or states no recognised type — the
   * caller treats that as a person (correctable via a local contact record).
   */
  kind?: "person" | "organisation";
  /** An organisation agent's own `foaf:logo`, distinct from a person's `avatarUrl`. */
  logoUrl?: string;
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
 * First label across `predicates` (in order), preferring the language tag `en`, then
 * `de`, then any. For Wikidata-style RDF whose `rdfs:label`/`schema:name`/
 * `skos:prefLabel` are `@lang`-tagged (the app chrome is English, so `en` first).
 */
function firstLabel(
  store: Store,
  subject: string,
  predicates: string[],
): string | undefined {
  const cands: { value: string; lang: string }[] = [];
  for (const p of predicates) {
    for (const q of store.getQuads(namedNode(subject), namedNode(p), null, null)) {
      const lang = q.object.termType === "Literal" ? q.object.language : "";
      cands.push({ value: q.object.value, lang });
    }
  }
  if (cands.length === 0) return undefined;
  const byLang = (l: string) => cands.find((c) => c.lang === l)?.value;
  return byLang("en") ?? byLang("de") ?? cands[0].value;
}

/**
 * A Wikidata logo/image IRI is a Commons `Special:FilePath` URL served over `http`
 * in Wikidata's RDF; upgrade to `https` so a deployed (https) app's `<img>` doesn't
 * hit mixed-content blocking.
 */
function commonsHttps(uri?: string): string | undefined {
  return uri?.replace(/^http:\/\/commons\.wikimedia\.org/, "https://commons.wikimedia.org");
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

/**
 * Classify an agent as person vs organisation. A standard `rdf:type`
 * (`…Organization`/`…Organisation` → org, `…Person`/`…Individual` → person) wins.
 *
 * Failing that, recognise the **MaStR wrapper** shape: its market actors aren't
 * typed foaf/vcard — they're `vocab:Operator` / `:GridOperator` / `:MarketActor`,
 * and the natural-vs-legal distinction lives in `mastr:Personenart`
 * ("Juristische Person" = a legal entity → organisation; "Natuerliche Person" →
 * person). `Personenart` is authoritative, so it's read first; absent it, an
 * actor/operator type is taken as an organisation (a kept MaStR operator carries a
 * Firmenname → a company, per the wrapper's regional-filter model). Suffix matches
 * keep this independent of the wrapper's host/namespace (mirrors the contact-fact
 * reads below).
 *
 * Last, a profile carrying none of these — but a `foaf:logo` — is an organisation.
 * Returns undefined when nothing distinguishes it, so the caller applies its own
 * default (person, correctable).
 */
function resolveKind(
  store: Store,
  webId: string,
): ResolvedAgent["kind"] {
  const types = objects(store, webId, RDF_TYPE);
  const isOrg = (t: string) =>
    t.endsWith("Organization") || t.endsWith("Organisation");
  const isPerson = (t: string) => t.endsWith("Person") || t.endsWith("Individual");
  if (types.some(isOrg)) return "organisation";
  if (types.some(isPerson)) return "person";

  const personenart = firstObjectBySuffix(store, webId, "Personenart");
  if (personenart) {
    if (/juristische/i.test(personenart)) return "organisation";
    if (/nat(ue|ü)rliche/i.test(personenart)) return "person";
  }
  const isMarketActor = (t: string) =>
    t.endsWith("Operator") || t.endsWith("MarketActor") || t.endsWith("Marktakteur");
  if (types.some(isMarketActor)) return "organisation";

  // A logo (own `foaf:logo` OR a Wikidata `wdt:P154` "logo image") marks an org.
  // P18 (generic image) is NOT a kind signal — a person entity can carry one.
  if (firstObject(store, webId, FOAF_LOGO) ?? firstObject(store, webId, WD_LOGO)) {
    return "organisation";
  }
  return undefined;
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
 * Name = `foaf:name` (preferred) or `vcard:fn`, then the Wikidata-style labels
 * (`rdfs:label`/`schema:name`/`skos:prefLabel`), falling back to the WebID fragment.
 * Avatar = `foaf:img` or `vcard:hasPhoto` (or the Wikidata generic image `wdt:P18`);
 * an org logo is `foaf:logo` or the Wikidata "logo image" `wdt:P154`. This lets a
 * Wikidata entity IRI (e.g. `…/entity/Q…`, served as CORS-open Turtle) resolve as a
 * first-class agent, not just a `foaf:`/`vcard:` Solid profile. Unreachable/private
 * profiles resolve to `{ webId }` (with the fragment name) — resolution never throws,
 * so callers can render references unconditionally.
 * @operation query
 */
/**
 * Fetch + parse an agent's RDF into a Store. A **Wikidata** entity (`qid` set) is a
 * PUBLIC resource whose `http://…/entity/Q…` IRI 301-redirects to https WITHOUT CORS
 * headers on the redirect (the browser blocks it) — so fetch the CORS-open
 * `Special:EntityData/Q….ttl` endpoint with a PLAIN (non-authed) fetch, not the Pod
 * transport (whose `Authorization`/DPoP would also trip a preflight). Any other agent
 * is a Solid profile read over the authed gateway. Never throws → null on any failure.
 */
async function loadAgentStore(
  webId: string,
  qid: string | undefined,
  gateway: PodGateway,
  fetchFn: typeof fetch,
): Promise<Store | null> {
  if (qid) {
    try {
      const res = await fetchFn(
        `https://www.wikidata.org/wiki/Special:EntityData/${qid}.ttl`,
      );
      if (!res.ok) return null;
      return new Store(new Parser({ format: "text/turtle" }).parse(await res.text()));
    } catch (err) {
      logError("fetch Wikidata entity for resolution", err);
      return null;
    }
  }
  try {
    return await loadProfileStoreFor(webId, gateway);
  } catch (err) {
    logError("load agent profile for resolution", err);
    return null;
  }
}

export async function resolveAgent(
  webId: string,
  gateway: PodGateway,
  fetchFn: typeof fetch = trackedFetch,
): Promise<ResolvedAgent> {
  const fallbackName = webIdFragment(webId);
  const qid = wikidataEntityId(webId);
  const store = await loadAgentStore(webId, qid, gateway, fetchFn);
  if (!store) return { webId, name: fallbackName };

  // For a Wikidata entity the store's subject is the CANONICAL `…/entity/Q…` IRI
  // (always `http`, however the doc was served / whatever form the caller passed),
  // so query by that, not the raw input.
  const subject = qid ? `http://www.wikidata.org/entity/${qid}` : webId;

  const name = firstObject(store, subject, FOAF_NAME) ??
    firstObject(store, subject, VCARD_FN) ??
    firstLabel(store, subject, [RDFS_LABEL, SCHEMA_NAME, SKOS_PREF_LABEL]) ??
    fallbackName;
  const avatarUrl = firstObject(store, subject, FOAF_IMG) ??
    firstObject(store, subject, VCARD_HAS_PHOTO) ??
    commonsHttps(firstObject(store, subject, WD_IMAGE));
  const kind = resolveKind(store, subject);
  const logoUrl = firstObject(store, subject, FOAF_LOGO) ??
    commonsHttps(firstObject(store, subject, WD_LOGO));

  // SavedAgent facts: standard vCard/FOAF first, then the MaStR wrapper's own
  // predicates as a fallback (it emits #Email/#Telefon/#Webseite, not vcard:*).
  const address = readAddress(store, subject);
  const email = bareEmail(
    firstObject(store, subject, VCARD_HAS_EMAIL) ??
      firstObject(store, subject, FOAF_MBOX) ??
      firstObjectBySuffix(store, subject, "#Email"),
  );
  const phone = firstObject(store, subject, VCARD_HAS_TELEPHONE) ??
    firstObjectBySuffix(store, subject, "#Telefon");
  const website = firstObject(store, subject, FOAF_HOMEPAGE) ??
    firstObject(store, subject, VCARD_HAS_URL) ??
    firstObjectBySuffix(store, subject, "#Webseite");

  return {
    webId,
    name,
    ...(kind ? { kind } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(logoUrl ? { logoUrl } : {}),
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

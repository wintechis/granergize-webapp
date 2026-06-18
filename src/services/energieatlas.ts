/**
 * Read `linked-energieatlas` — Bavaria's rooftop-PV & solar potential per Gemeinde
 * (Energie-Atlas Bayern), as content-negotiated Linked Data. One resource per
 * municipality at `area/{ags}`, keyed by its 8-digit AGS (leading `09` = Bavaria),
 * carrying a `vocab:AreaPotential` with the rooftop-PV figures (installable / installed
 * capacity, build-out degree = Ausbaugrad, solar-thermal, use-shares).
 *
 * There is no bulk endpoint, so the Gemeinde choropleth fetches ONE resource per
 * visible municipality (cached per AGS) and shades by a chosen field. A queried,
 * off-Pod external source — reached through {@link trackedFetch}; the parse is split
 * out pure for offline unit-testing (mirrors {@link ./regionalCube.ts}).
 */
import { parseRdfText } from "./rdf/rdfHelpers.ts";
import { RDF_TYPE, SKOS_NS } from "./rdf/vocabularies.ts";
import { trackedFetch } from "../lib/networkActivity.ts";

const VOCAB_NS = "https://wunderfacts.com/energieatlas/vocab#";
const AREA_POTENTIAL = `${VOCAB_NS}AreaPotential`;
const SKOS_NOTATION = `${SKOS_NS}notation`;

/** The rooftop-PV / solar potential of one Bavarian Gemeinde (Energie-Atlas Bayern). */
export interface GemeindePotential {
  /** 8-digit AGS (the join key). */
  ags: string;
  /** Municipality name. */
  name: string;
  /** Build-out degree (Ausbaugrad) — installed / installable, in %. The headline
   *  choropleth metric: how little of the rooftop potential is realised. */
  developmentDegreePct: number | null;
  /** Installable rooftop-PV capacity (MWp). */
  pvPotentialCapacityMWp: number | null;
  /** Already-installed PV capacity (MWp). */
  installedCapacityMWp: number | null;
  /** Unrealised headroom (MWp). */
  remainingPotentialMWp: number | null;
}

/** The dereferenceable IRI of one Gemeinde's potential resource. */
export function areaPotentialUrl(ags: string): string {
  const env =
    (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const base = env?.VITE_ENERGIEATLAS_API_URI || "https://wunderfacts.com/energieatlas/";
  return `${base}area/${ags}`;
}

/**
 * Parse one `area/{ags}` document into its {@link GemeindePotential}, or `null` if it
 * carries no `vocab:AreaPotential`. Pure — the network-free half, unit-tested.
 */
export function parseAreaPotential(
  turtle: string,
  baseIri: string,
): GemeindePotential | null {
  const store = parseRdfText(turtle, baseIri);
  const subj = store.getQuads(null, RDF_TYPE, AREA_POTENTIAL, null)[0]?.subject;
  if (!subj) return null;

  const str = (pred: string): string =>
    store.getQuads(subj, pred, null, null)[0]?.object.value ?? "";
  const num = (prop: string): number | null => {
    const v = store.getQuads(subj, `${VOCAB_NS}${prop}`, null, null)[0]?.object.value;
    if (v == null) return null;
    const n = Number.parseFloat(v);
    return Number.isNaN(n) ? null : n;
  };

  return {
    ags: str(SKOS_NOTATION),
    name: str(`${VOCAB_NS}name`),
    developmentDegreePct: num("developmentDegreePct"),
    pvPotentialCapacityMWp: num("pvPotentialCapacityMWp"),
    installedCapacityMWp: num("installedCapacityMWp"),
    remainingPotentialMWp: num("remainingPotentialMWp"),
  };
}

/** Fetch + parse one Gemeinde's potential. Throws on a non-OK response. */
export async function fetchAreaPotential(ags: string): Promise<GemeindePotential | null> {
  const url = areaPotentialUrl(ags);
  const res = await trackedFetch(
    url,
    { headers: { Accept: "text/turtle" } },
    `energieatlas ${ags}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching energieatlas ${ags}`);
  return parseAreaPotential(await res.text(), url);
}

/** AGS prefix of the Bavarian Länderschlüssel — the only coverage Energie-Atlas has. */
export const BAVARIA_AGS_PREFIX = "09";

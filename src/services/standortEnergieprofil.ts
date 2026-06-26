/**
 * Read the per-Gemeinde energy profile from **`linked-energieatlas`**
 * (`https://wunderfacts.com/energieatlas`) — the Bavarian Energie-Atlas
 * re-published as content-negotiated RDF, one `vocab:AreaPotential` resource per
 * municipality keyed by its 8-digit AGS. The follow-your-nose sibling of
 * {@link ./mastrNearby.ts} and {@link ./linkedWeather.ts}.
 *
 * Powers the "Standort-Energieprofil" panel: ONE `area/{ags}` document carries all
 * the merged layers, so a single fetch yields every card — rooftop-PV and
 * Freiflächen-PV Ausbaulücke, the renewable share + generation mix, and biomass.
 *
 * Bavaria-only (the pilot scope): an AGS the wrapper has no data for — anything
 * outside Bavaria — 404s and degrades to `null` rather than throwing, so the panel
 * simply does not appear off-pilot. Off-Pod and queried; reached through
 * {@link trackedFetch}. The parse is split out pure for offline unit-testing.
 */
import type { Store } from "n3";
import { RDF_TYPE } from "./rdf/vocabularies.ts";
import { sourceBase } from "../constants/dataSources.ts";
import { getSourceGateway } from "./sources/sourceGateway.ts";
import { deref } from "./sources/capabilities.ts";

/** A potential-vs-installed card (rooftop or ground-mounted PV). */
export interface PotentialCard {
  /** Installable capacity (MWp). */
  potentialMWp: number;
  /** Already-installed capacity (MWp). */
  installedMWp: number;
  /** Unrealised headroom = potential − installed (MWp) — the Ausbaulücke. */
  remainingMWp: number;
  /** Build-out degree (%) = installed / potential — Ausbaugrad. */
  degreePct: number;
}

/** A renewable carrier and its share of the local renewable electricity. */
export interface MixEntry {
  carrier: "solar" | "wind" | "biomass" | "hydro" | "geothermal";
  sharePct: number;
}

/** The green-electricity card: renewable share of consumption + the carrier mix. */
export interface GreenCard {
  renewableSharePct: number;
  /** Carriers with a non-zero share, largest first. */
  mix: MixEntry[];
}

/** The biomass card. */
export interface BiomassCard {
  /** Technical biogas-electricity potential (GWh/a, converted from kWh/a). */
  biogasPotentialGWh: number;
  /** Installed biomass-electricity capacity (MW). */
  installedMW: number;
  /** Number of biomass plants. */
  plantCount: number;
}

/** The Gemeinde's energy profile — each card present only when its data is served. */
export interface AreaProfile {
  name: string;
  rooftop?: PotentialCard;
  ground?: PotentialCard;
  green?: GreenCard;
  biomass?: BiomassCard;
}

/** Base IRI of linked-energieatlas — delegates to the registry resolver (env-overridable). */
export function linkedEnergieatlasBase(): string {
  return sourceBase("energieatlas");
}

/** The dereferenceable `area/{ags}` IRI (and the Developer-mode source link). */
export function areaUrl(ags: string): string {
  return `${linkedEnergieatlasBase()}area/${ags}`;
}

/** The wrapper's coined-vocabulary namespace (served absolute under the host). */
function vocabNs(): string {
  return `${linkedEnergieatlasBase()}vocab#`;
}

/**
 * Parse an `area/{ags}` Turtle document into the Gemeinde's energy profile. Pure
 * (network-free). Reads every numeric `vocab:` metric on the `vocab:AreaPotential`
 * thing into a map, then assembles the cards — each present only when its key
 * metric is served (so a Gemeinde missing a layer just lacks that card). The
 * remaining-headroom / degree of a PV card are derived when not pre-computed.
 * Returns `null` when no `vocab:AreaPotential` thing or no card metric is present.
 */
export function parseAreaProfile(store: Store): AreaProfile | null {
  const v = vocabNs();
  let subject = null;
  for (const q of store.getQuads(null, RDF_TYPE, `${v}AreaPotential`, null)) {
    subject = q.subject;
    break;
  }
  if (!subject) return null;

  const m = new Map<string, number>();
  let name = "";
  for (const q of store.getQuads(subject, null, null, null)) {
    const p = q.predicate.value;
    if (p === `${v}name`) {
      name = q.object.value;
    } else if (p.startsWith(v)) {
      const n = Number.parseFloat(q.object.value);
      if (!Number.isNaN(n)) m.set(p.slice(v.length), n);
    }
  }
  const g = (k: string): number | undefined => m.get(k);

  const potentialCard = (
    potKey: string,
    instKey: string,
    remKey?: string,
    degKey?: string,
  ): PotentialCard | undefined => {
    const pot = g(potKey);
    if (pot == null) return undefined;
    const inst = g(instKey) ?? 0;
    const rem = (remKey ? g(remKey) : undefined) ?? pot - inst;
    const deg = (degKey ? g(degKey) : undefined) ??
      (pot > 0 ? (inst / pot) * 100 : 0);
    return { potentialMWp: pot, installedMWp: inst, remainingMWp: rem, degreePct: deg };
  };

  const rooftop = potentialCard(
    "pvPotentialCapacityMWp",
    "installedCapacityMWp",
    "remainingPotentialMWp",
    "developmentDegreePct",
  );
  const ground = potentialCard(
    "groundPvPotentialCapacityMWp",
    "groundPvInstalledCapacityMWp",
  );

  let green: GreenCard | undefined;
  const share = g("renewableElectricitySharePct");
  if (share != null) {
    const carriers: ReadonlyArray<[MixEntry["carrier"], string]> = [
      ["solar", "eeSharePvPct"],
      ["wind", "eeShareWindPct"],
      ["biomass", "eeShareBiomassPct"],
      ["hydro", "eeShareHydroPct"],
      ["geothermal", "eeShareGeothermalPct"],
    ];
    const mix = carriers
      .map(([carrier, key]): MixEntry => ({ carrier, sharePct: g(key) ?? 0 }))
      .filter((e) => e.sharePct > 0)
      .sort((a, b) => b.sharePct - a.sharePct);
    green = { renewableSharePct: share, mix };
  }

  let biomass: BiomassCard | undefined;
  const biogasKWh = g("biogasPotentialElectricKWhPerYear");
  const bioInstalled = g("biomassInstalledCapacityMW");
  if (biogasKWh != null || bioInstalled != null) {
    biomass = {
      biogasPotentialGWh: (biogasKWh ?? 0) / 1e6,
      installedMW: bioInstalled ?? 0,
      plantCount: g("biomassInstallationCount") ?? 0,
    };
  }

  if (!rooftop && !ground && !green && !biomass) return null;
  return { name, rooftop, ground, green, biomass };
}

/**
 * Fetch + parse the energy profile for a Gemeinde AGS. Returns `null` when the
 * wrapper has no data for that AGS (outside Bavaria → 404, or a non-OK response),
 * so the panel degrades gracefully rather than erroring.
 */
export async function fetchAreaProfile(ags: string): Promise<AreaProfile | null> {
  try {
    const store = await deref(
      getSourceGateway(),
      areaUrl(ags),
      "location energy profile",
    );
    return parseAreaProfile(store);
  } catch {
    return null; // outside Bavaria → 404; the panel simply doesn't appear
  }
}

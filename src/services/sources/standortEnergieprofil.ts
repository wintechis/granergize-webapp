/**
 * Read the per-Gemeinde energy profile from **`linked-energieatlas`**
 * (`https://wunderfacts.com/energieatlas`) — the Bavarian Energie-Atlas
 * re-published as content-negotiated RDF, one **`qb:` Data Cube** document per
 * municipality (`area/{ags}`, keyed by its 8-digit AGS) whose `qb:Observation`s
 * carry the metrics on a `#dim-indicator` dimension. The follow-your-nose sibling
 * of {@link ./mastrNearby.ts} and {@link ./linkedWeather.ts}, and a cube read
 * through the same {@link ./regionalCube.ts} parser as regionalstatistik.
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
import { RDFS_LABEL } from "../rdf/vocabularies.ts";
import { sourceBase } from "../../constants/dataSources.ts";
import type { EnergieatlasRoute } from "../../generated/energieatlas.routes.ts";
import { getSourceGateway } from "./sourceGateway.ts";
import { deref } from "./capabilities.ts";
import { parseCubeIndicatorValues } from "./regionalCube.ts";

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
  /** Number of rooftop-PV installations in the Gemeinde (for the per-installation
   *  average in {@link computePvBenchmark}); absent when the wrapper omits it. */
  pvInstallationCount?: number;
}

/**
 * The building's rooftop PV set against its Gemeinde's — a **read-time benchmark**,
 * not stored data: the building's own cell (installed + LoD2-computed potential) held
 * against the Gemeinde aggregate cell (`linked-energieatlas`), joined by AGS. Because
 * the aggregate is non-decomposable (one figure, members dropped) this is
 * contextualisation, never a percentile ranking — see `notes/detail-vs-statistics.md`.
 */
export interface PvBenchmark {
  /** This building's installed PV (kWp) — the sum of its `<#pv>` system capacities. */
  buildingInstalledKwp: number;
  /** This building's installable rooftop PV (kWp), computed in-app from LoD2 geometry. */
  buildingPotentialKwp: number;
  /** #1 realization — this building's installed ÷ potential (%). */
  buildingRealizationPct: number;
  /** #1 realization — the Gemeinde's installed ÷ potential (%), pre-computed upstream. */
  regionRealizationPct: number;
  /** #2 headroom — the Gemeinde's remaining rooftop potential (MWp) this roof adds into. */
  regionRemainingMWp: number;
  /** #3 typical size — the Gemeinde's mean installed PV per installation (kWp), or
   *  `null` when the installation count is unavailable. */
  avgInstallationKwp: number | null;
}

/**
 * The linked-energieatlas routes the app calls, checked at COMPILE TIME against the wrapper's
 * DEPLOYED route set (`src/generated/energieatlas.routes.ts`, regenerated from the live `/routes`
 * manifest — `deno task gen:routes:energieatlas`). The app only dereferences the per-Gemeinde
 * `area/{ags}` profile; a rename/removal upstream makes the literal unassignable to
 * {@link EnergieatlasRoute}, so `deno task check` fails rather than the Standort-Energieprofil panel
 * silently vanishing. See `explore/explore-wrapper-contract-drift.md`.
 */
export const ENERGIEATLAS_ROUTES = {
  area: "area",
} as const satisfies Record<string, EnergieatlasRoute>;

/** Base IRI of linked-energieatlas — delegates to the registry resolver (env-overridable). */
export function linkedEnergieatlasBase(): string {
  return sourceBase("energieatlas");
}

/** The dereferenceable `area/{ags}` IRI (and the Developer-mode source link). */
export function areaUrl(ags: string): string {
  return `${linkedEnergieatlasBase()}${ENERGIEATLAS_ROUTES.area}/${ags}`;
}

/**
 * Parse an `area/{ags}` Turtle document into the Gemeinde's energy profile. Pure
 * (network-free). The wrapper serves the region as an **RDF Data Cube**: one
 * `qb:Observation` per indicator, so the metrics are read through the shared
 * {@link parseCubeIndicatorValues} into an `indicator → value` map, then assembled
 * into the cards — each present only when its key metric is served (so a Gemeinde
 * missing a layer just lacks that card). The remaining-headroom / degree of a PV
 * card are derived when not pre-computed. Returns `null` when no observations or no
 * card metric is present.
 */
export function parseAreaProfile(store: Store): AreaProfile | null {
  const m = parseCubeIndicatorValues(store);
  if (m.size === 0) return null;

  // The Gemeinde name is the region descriptor's rdfs:label (the only labelled
  // resource in a single-region cube document).
  let name = "";
  for (const q of store.getQuads(null, RDFS_LABEL, null, null)) {
    name = q.object.value;
    break;
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
  return { name, rooftop, ground, green, biomass, pvInstallationCount: g("installationCount") };
}

/**
 * Derive the rooftop-PV benchmark for one building against its Gemeinde. Pure. The
 * building supplies its installed capacity (kWp, summed over its `<#pv>` systems) and
 * its LoD2-computed potential (kWp); the region half comes from the Gemeinde's rooftop
 * card. Returns `null` when the region has no rooftop figure or the building has no
 * positive potential (nothing to compare). Units are reconciled here (Gemeinde MWp →
 * kWp) so the caller renders raw numbers.
 */
export function computePvBenchmark(
  buildingInstalledKwp: number,
  buildingPotentialKwp: number,
  area: AreaProfile,
): PvBenchmark | null {
  const r = area.rooftop;
  if (!r || buildingPotentialKwp <= 0) return null;
  return {
    buildingInstalledKwp,
    buildingPotentialKwp,
    buildingRealizationPct: (buildingInstalledKwp / buildingPotentialKwp) * 100,
    regionRealizationPct: r.degreePct,
    regionRemainingMWp: r.remainingMWp,
    avgInstallationKwp: area.pvInstallationCount && area.pvInstallationCount > 0
      ? (r.installedMWp * 1000) / area.pvInstallationCount
      : null,
  };
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

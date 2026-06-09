import { BuildingType, EnergyType } from "../../types.ts";

/**
 * Energy-map categorisation — the pure core behind the map's "energy lens"
 * (handbuch Praxisbeispiel "Vertriebsoptimierung": a visual categorisation of
 * buildings by energy consumption so a logistics object reads, at a glance, as
 * more or less efficient than its neighbours). No React / Leaflet here so the
 * thresholds are unit-testable in isolation; the colours and the marker live in
 * `ExplorePage.tsx`.
 *
 * The comparison is by *intensity* (energy per floor area), not absolute kWh —
 * absolute consumption just tracks building size and would rank a large
 * efficient hall worse than a small wasteful one.
 */

export type EnergyCategory = "efficient" | "typical" | "inefficient" | "none";

/** Sum the numeric values of an energy sub-section (mirrors `Energy.tsx`). */
function sumValues(section: Record<string, number | undefined>): number {
  return Object.values(section)
    .filter((v): v is number => typeof v === "number")
    .reduce((sum, v) => sum + v, 0);
}

/**
 * The building's annual energy figure used as the consumption proxy: the total
 * `energyNeed` (demand across all carriers), summed the same way the energy tab
 * sums a section. Latest-year data is what the parser surfaces, matching the
 * `/energy/:id` latest-year view; sub-hourly series are out of scope here.
 */
export function annualEnergyKwh(energy: EnergyType): number {
  return sumValues(energy.energyNeed);
}

/**
 * The reference floor area for intensity. Hall-area first (logistics objects are
 * dominated by hall floor space), then the gross building area, then office
 * area. `null` when none is known.
 */
export function referenceArea(building: BuildingType): number | null {
  return building.hallArea ?? building.buildingArea ?? building.officeArea ??
    null;
}

/**
 * Energy intensity (kWh per m² per year), or `null` when it can't be computed —
 * no usable area, or no annual energy figure. A `null` intensity is later
 * categorised as `"none"` (neutral marker).
 */
export function energyIntensity(
  building: BuildingType,
  energy: EnergyType | undefined,
): number | null {
  if (!energy) return null;
  const area = referenceArea(building);
  if (area == null || !(area > 0)) return null;
  const kwh = annualEnergyKwh(energy);
  if (!(kwh > 0)) return null;
  return kwh / area;
}

/** Linear-interpolated quantile of an ascending-sorted, non-empty array. */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

/**
 * Place an intensity into a category relative to its peers (the intensities of
 * the buildings currently in view — caller-supplied, so panning re-frames the
 * comparison). Lower intensity = more efficient = `"efficient"`.
 *
 * With three or more comparable peers the split is by terciles of the peer
 * distribution (robust across building types — a fixed kWh/m² threshold would
 * not be). With fewer, terciles aren't meaningful, so it falls back to a
 * split on the peer mean (the same below/above logic the energy grid uses).
 */
export function categorise(
  intensity: number | null,
  peerIntensities: number[],
): EnergyCategory {
  if (intensity == null || !Number.isFinite(intensity)) return "none";
  const peers = peerIntensities.filter((v) => Number.isFinite(v));
  if (peers.length === 0) return "typical";

  if (peers.length < 3) {
    const mean = peers.reduce((sum, v) => sum + v, 0) / peers.length;
    if (intensity < mean) return "efficient";
    if (intensity > mean) return "inefficient";
    return "typical";
  }

  const sorted = [...peers].sort((a, b) => a - b);
  const lower = quantile(sorted, 1 / 3);
  const upper = quantile(sorted, 2 / 3);
  if (intensity <= lower) return "efficient";
  if (intensity >= upper) return "inefficient";
  return "typical";
}

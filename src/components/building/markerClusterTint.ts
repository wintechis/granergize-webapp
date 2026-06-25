import { type LensBand } from "../../services/energy/energyTimeCut.ts";
import { type MetricFraming } from "../../services/energy/energyMetric.ts";
import { bandColor, legendBands } from "../../constants/lensBand.ts";
import {
  MARKER_OPEN_COLOR,
  MARKER_OWNED_COLOR,
} from "../../constants/chartColors.ts";

/** Pull the band out of a marker `className` (`energy-marker energy-<band>`). */
const ENERGY_BAND =
  /\benergy-(efficient|typical|inefficient|low|mid|high|none)\b/;

/**
 * The most-representative band among a cluster's children, under the given framing.
 * The most frequent non-`none` band wins; ties break toward the **worse / higher** band
 * (later in `legendBands` order — `inefficient` for tier, `high` for magnitude), so a
 * cluster never looks better than its constituents. Empty / all-`none` → `"none"`. Pure.
 */
export function dominantBand(bands: LensBand[], framing: MetricFraming): LensBand {
  const order = legendBands(framing); // best/lowest → worst/highest, `none` last
  const counts = new Map<LensBand, number>();
  for (const b of bands) if (b !== "none") counts.set(b, (counts.get(b) ?? 0) + 1);
  if (counts.size === 0) return "none";
  let pick: LensBand = "none";
  let best = 0;
  for (const b of order) {
    const n = counts.get(b) ?? 0;
    if (n > 0 && n >= best) {
      pick = b; // `>=` → a later (worse/higher) band wins a tie
      best = n;
    }
  }
  return pick;
}

/** A cluster bubble's fill colour + the classes appended to `marker-cluster`. */
export interface ClusterStyle {
  color: string;
  /** Extra classes (so an e2e/test can assert the cluster's kind + band). */
  className: string;
}

/**
 * Derive a cluster bubble's style from its child markers' `className`s. An **energy**
 * cluster (children carry `energy-<band>`) is tinted by its {@link dominantBand} under
 * the framing the band names imply — a mini regional energy summary. An **ownership**
 * cluster is a neutral bubble: green when it holds only open (`pin-open`) children, else
 * the owned-marker colour. Pure → unit-tested.
 */
export function clusterStyle(childClassNames: string[]): ClusterStyle {
  const bands: LensBand[] = [];
  let hasOpen = false;
  let hasOwnedOrShared = false;
  for (const cn of childClassNames) {
    const m = ENERGY_BAND.exec(cn);
    if (m) bands.push(m[1] as LensBand);
    if (/\bpin-open\b/.test(cn)) hasOpen = true;
    if (/\bpin-(owned|shared)\b/.test(cn)) hasOwnedOrShared = true;
  }
  if (bands.length > 0) {
    const framing: MetricFraming =
      bands.some((b) => b === "low" || b === "mid" || b === "high")
        ? "magnitude"
        : "tier";
    const band = dominantBand(bands, framing);
    return {
      color: bandColor(band, framing),
      className: `energy-cluster energy-${band}`,
    };
  }
  const open = hasOpen && !hasOwnedOrShared;
  return {
    color: open ? MARKER_OPEN_COLOR : MARKER_OWNED_COLOR,
    className: open ? "pin-cluster pin-open" : "pin-cluster",
  };
}

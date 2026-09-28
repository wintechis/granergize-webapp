import type { MessageId } from "../lib/messages.ts";
import type { EnergyTrend } from "../services/energy/energyTrend.ts";
import {
  MARKER_NO_DATA_COLOR,
  TREND_FLAT_COLOR,
  TREND_IMPROVING_COLOR,
  TREND_WORSENING_COLOR,
} from "./chartColors.ts";

/**
 * The **trend** presentation table — label + colour per year-over-year direction,
 * the twin of `lensBand.ts` for the other colour system on the over-time heatmap.
 * Where a lens band is *peer-relative* (a building against the others shown in that
 * year), a trend is *self-relative* (a building against its own prior year); the two
 * therefore carry deliberately different palettes so a "got better" dot can't be
 * misread as the "efficient" tier (see `chartColors.ts`).
 *
 * Split into two parallel records like `tiers.ts` (`TIER_LABEL`/`TIER_COLOR`) rather
 * than one `{color, label}` object, and with no `trendLabelKey()`/`trendColor()`
 * accessors: `bandLabelKey`/`bandColor` exist only because lens bands have TWO tables
 * selected by framing, whereas a trend has one — direct indexing is the smaller
 * surface. Lives in `constants/` (not in the component that renders it) so the
 * ordering and the labels are reachable from `deno test`, where MUI can't load.
 */

/** i18n label per trend — the matrix's Trend column and its legend key. */
export const TREND_LABEL: Record<EnergyTrend, MessageId> = {
  improving: "trendImproving",
  flat: "trendFlat",
  worsening: "trendWorsening",
  unknown: "trendUnknown",
};

/** Dot colour per trend — the colourblind-safe diverging blue↔orange pair, with a
 *  building that has no two comparable years on the neutral no-data grey. */
export const TREND_COLOR: Record<EnergyTrend, string> = {
  improving: TREND_IMPROVING_COLOR,
  flat: TREND_FLAT_COLOR,
  worsening: TREND_WORSENING_COLOR,
  unknown: MARKER_NO_DATA_COLOR,
};

/** The ordered trends a legend lists — best → worst, "no trend yet" last (mirroring
 *  `legendBands`, whose `none` also trails). */
export const LEGEND_TRENDS: readonly EnergyTrend[] = [
  "improving",
  "flat",
  "worsening",
  "unknown",
];

import { type LensBand } from "../services/energy/energyTimeCut.ts";
import { type MetricFraming } from "../services/energy/energyMetric.ts";
import {
  ENERGY_ABOVE_AVG_COLOR,
  ENERGY_BELOW_AVG_COLOR,
  ENERGY_TYPICAL_COLOR,
  MAGNITUDE_HIGH_COLOR,
  MAGNITUDE_LOW_COLOR,
  MAGNITUDE_MID_COLOR,
  MARKER_NO_DATA_COLOR,
} from "./chartColors.ts";
import { type MessageId } from "../lib/messages.ts";

/**
 * The colour + i18n label for a cube-view band, picked by the metric's **framing**
 * (the cross-cutting metric selector, plan-cube-ui). Consumption metrics colour by
 * efficiency tier (green→amber→red, a value judgement); generation colours by a
 * NEUTRAL low→high blue magnitude ramp (no good/bad). Centralised so the map markers,
 * the over-time matrix and the compare-years panel read identically.
 */

const TIER_COLOR: Record<string, string> = {
  efficient: ENERGY_BELOW_AVG_COLOR,
  typical: ENERGY_TYPICAL_COLOR,
  inefficient: ENERGY_ABOVE_AVG_COLOR,
  none: MARKER_NO_DATA_COLOR,
};

const MAGNITUDE_COLOR: Record<string, string> = {
  low: MAGNITUDE_LOW_COLOR,
  mid: MAGNITUDE_MID_COLOR,
  high: MAGNITUDE_HIGH_COLOR,
  none: MARKER_NO_DATA_COLOR,
};

/** The cell/marker colour for a band under a framing. */
export function bandColor(band: LensBand, framing: MetricFraming): string {
  const table = framing === "magnitude" ? MAGNITUDE_COLOR : TIER_COLOR;
  return table[band] ?? MARKER_NO_DATA_COLOR;
}

const TIER_LABEL_KEY: Record<string, MessageId> = {
  efficient: "lensTierEfficient",
  typical: "lensTierTypical",
  inefficient: "lensTierInefficient",
  none: "lensBandNoData",
};

const MAGNITUDE_LABEL_KEY: Record<string, MessageId> = {
  low: "lensMagnitudeLow",
  mid: "lensMagnitudeMid",
  high: "lensMagnitudeHigh",
  none: "lensBandNoData",
};

/** The message key for a band's label under a framing. */
export function bandLabelKey(band: LensBand, framing: MetricFraming): MessageId {
  const table = framing === "magnitude" ? MAGNITUDE_LABEL_KEY : TIER_LABEL_KEY;
  return table[band] ?? "lensBandNoData";
}

/** The ordered bands a legend lists for a framing (best/lowest first → no-data last). */
export function legendBands(framing: MetricFraming): LensBand[] {
  return framing === "magnitude"
    ? ["low", "mid", "high", "none"]
    : ["efficient", "typical", "inefficient", "none"];
}

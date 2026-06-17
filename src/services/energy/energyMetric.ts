import { BuildingType } from "../../types.ts";
import {
  type AnnualMetrics,
  type EnergyMetricKey,
} from "../rdf/energyDataset.ts";
import { referenceArea } from "./energyCategory.ts";
import { type MessageId } from "../../lib/messages.ts";

/**
 * The **measure axis** of the space × time cube made selectable — the cross-cutting
 * "metric / observed-property selection" of `plans/plan-cube-ui.md`. Every cube view
 * (the time-cut slider, the over-time matrix, the trend lens, the compare-years small
 * multiples, the energy × weather overlay) visualises *one* observed property; this
 * module is the single description of *which* properties can be selected and *how* each
 * is framed, so the views read a chosen metric off the loaded `AnnualMetrics` rather
 * than hard-coding consumption.
 *
 * React/MUI-free: the selectable set, the per-(building, year) value extraction and the
 * framing split are pure and unit-testable; the `<Select>` widget and the colour ramp
 * live in `ExplorePage.tsx`.
 *
 * Two framings, picked by the metric's nature (NOT by a role — see CLAUDE.md):
 * - **consumption** (electricity / heat / water / wastewater) → the existing
 *   **per-m² intensity + efficiency tiers** (efficient / typical / inefficient): less
 *   energy per floor area is "better", so the tier carries a value judgement.
 * - **generation** (electricity generation) → **relative magnitude** on a neutral
 *   sequential ramp, NO good/bad labels. More PV output is not "inefficient"; an
 *   intensity tier is meaningless for it. Magnitude is the *absolute* figure (kWh),
 *   not per-m² — generation tracks installed plant, not floor area.
 */

/** The framing a metric uses to colour the cube. */
export type MetricFraming = "tier" | "magnitude";

/** A metric the cube views can be lensed/trended/compared on. */
export interface SelectableMetric {
  key: EnergyMetricKey;
  framing: MetricFraming;
}

/**
 * The selectable measure axis: the four absolute consumption metrics (tier-framed,
 * per-m² intensity) plus electricity generation (magnitude-framed). The ratio metric
 * (`renewableSelfGeneratedShare`, a %) is deliberately excluded — it is neither an
 * absolute consumption to normalise by area nor a magnitude to rank. Order is the
 * order the selector offers them; the first (electricity consumption) is the default,
 * matching the map's pre-selector behaviour.
 */
export const SELECTABLE_METRICS: SelectableMetric[] = [
  { key: "electricityConsumption", framing: "tier" },
  { key: "heatConsumption", framing: "tier" },
  { key: "waterConsumption", framing: "tier" },
  { key: "wastewaterConsumption", framing: "tier" },
  { key: "electricityGeneration", framing: "magnitude" },
];

/** The default selection — electricity consumption (the map's pre-selector lens). */
export const DEFAULT_METRIC: EnergyMetricKey = "electricityConsumption";

const FRAMING_BY_KEY = new Map<EnergyMetricKey, MetricFraming>(
  SELECTABLE_METRICS.map((m) => [m.key, m.framing]),
);

/** Whether `key` is one the views can lens on. */
export function isSelectableMetric(key: string): key is EnergyMetricKey {
  return FRAMING_BY_KEY.has(key as EnergyMetricKey);
}

/**
 * Decode a metric from the URI (`?m=`): the metric itself when it is selectable, else
 * the default — so a stale/shared link with an unknown metric falls back rather than
 * showing a blank view. Mirrors `clampYear` for the year axis.
 */
export function clampMetric(raw: string | null | undefined): EnergyMetricKey {
  return raw != null && isSelectableMetric(raw) ? raw : DEFAULT_METRIC;
}

/** The framing for a metric (`"tier"` for consumption, `"magnitude"` for generation). */
export function metricFraming(key: EnergyMetricKey): MetricFraming {
  return FRAMING_BY_KEY.get(key) ?? "tier";
}

/**
 * The i18n message key for a selectable metric's short label. Returned as a string
 * (an `messages.ts` MessageId) so the widget resolves it through `useT()`; kept here
 * beside the metric definitions so adding a metric updates one place.
 */
export function metricLabelKey(key: EnergyMetricKey): MessageId {
  return `metric${key.charAt(0).toUpperCase()}${key.slice(1)}` as MessageId;
}

/**
 * The per-(building, year) value a cube view reads for the selected metric, from one
 * year's `AnnualMetrics`. `null` when the metric isn't present that year, or the value
 * can't be framed.
 *
 * - **tier (consumption):** the *intensity* — the metric figure divided by the
 *   building's reference floor area (`referenceArea`), kWh/m² (or m³/m²) per year — so
 *   size doesn't masquerade as efficiency (the same proxy `energyCategory.ts` uses).
 *   `null` when there is no usable area or no positive figure.
 * - **magnitude (generation):** the *absolute* figure (kWh), un-normalised — generation
 *   ranks by raw output, not per floor area. `null` when there is no positive figure.
 */
export function metricValueAtYear(
  building: BuildingType,
  metrics: AnnualMetrics | undefined,
  key: EnergyMetricKey,
): number | null {
  if (!metrics) return null;
  const raw = metrics[key];
  if (raw == null || !Number.isFinite(raw) || !(raw > 0)) return null;
  if (metricFraming(key) === "magnitude") return raw;
  // tier: per-m² intensity
  const area = referenceArea(building);
  if (area == null || !(area > 0)) return null;
  return raw / area;
}

/**
 * The **absolute** figure of a metric in one year's `AnnualMetrics` (no per-area
 * normalisation), or `null` when absent / non-positive. The energy × weather overlay
 * plots absolute energy against temperature, so it reads this rather than the
 * framing-dependent `metricValueAtYear` (which would per-m² a consumption metric).
 */
export function metricRawAtYear(
  metrics: AnnualMetrics | undefined,
  key: EnergyMetricKey,
): number | null {
  const raw = metrics?.[key];
  return raw != null && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** A magnitude bucket: low / mid / high on a neutral ramp, or `none` for no value. */
export type MagnitudeBucket = "low" | "mid" | "high" | "none";

/** Linear-interpolated quantile of an ascending-sorted, non-empty array. */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  return next === undefined ? sorted[base] : sorted[base] + rest * (next - sorted[base]);
}

/**
 * Build a **magnitude** categoriser for one peer set (the visible buildings' values for
 * the selected generation metric). Splits by terciles of the peer distribution into
 * low / mid / high — a *neutral* ranking (no efficient/inefficient judgement). Mirrors
 * `categoriserFor`'s threshold logic, but the bands carry no value verdict.
 *
 * With <3 peers terciles aren't meaningful, so it splits on the peer mean (below = low,
 * above = high). With no peers everything reads `"mid"`. A missing value is `"none"`.
 */
export function magnitudeCategoriserFor(
  peerValues: number[],
): (value: number | null) => MagnitudeBucket {
  const peers = peerValues.filter((v) => Number.isFinite(v));

  let classify: (value: number) => MagnitudeBucket;
  if (peers.length === 0) {
    classify = () => "mid";
  } else if (peers.length < 3) {
    const mean = peers.reduce((sum, v) => sum + v, 0) / peers.length;
    classify = (value) => (value < mean ? "low" : value > mean ? "high" : "mid");
  } else {
    const sorted = [...peers].sort((a, b) => a - b);
    const lower = quantile(sorted, 1 / 3);
    const upper = quantile(sorted, 2 / 3);
    classify = (value) => (value <= lower ? "low" : value >= upper ? "high" : "mid");
  }

  return (value) =>
    value == null || !Number.isFinite(value) ? "none" : classify(value);
}

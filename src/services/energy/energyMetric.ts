import { Building } from "../../types.ts";
import {
  type AnnualMetrics,
  type EnergyMetricKey,
} from "../energy/energyDataset.ts";
import { annualMetricDesc } from "../../constants/annualMetrics.ts";
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
 * live in `building/BuildingsMap.tsx`.
 *
 * Two framings, picked by the metric's nature (NOT by a role — see CLAUDE.md):
 * - **consumption** (electricity / heat / water / wastewater) → the existing
 *   **per-m² intensity + efficiency tiers** (efficient / typical / inefficient): less
 *   energy per floor area is "better", so the tier carries a value judgement.
 * - **generation** (electricity generation) → **relative magnitude** on a neutral
 *   sequential ramp, NO good/bad labels. More PV output is not "inefficient"; an
 *   intensity tier is meaningless for it. Magnitude is the *absolute* figure (kWh),
 *   not per-m² — generation tracks installed plant, not floor area.
 *
 * The axis also carries ONE **derived** measure — {@link ENERGY_TOTAL}, the property
 * ladder's rollup rung (`notes/observation-cube-sketch.md`): the sum of the two kWh
 * carriers. It is a *display* rollup, never a stored figure, so it lives in the wider
 * {@link SelectableMetricKey} and must stay out of `EnergyMetricKey` (the stored dataset
 * keys that feed `AnnualMetrics`, `ENERGY_METRICS`, the entry form and the aggregation
 * metric lists — the compiler rejects the pseudo-metric there, by design).
 */

/** The framing a metric uses to colour the cube. */
export type MetricFraming = "tier" | "magnitude";

/**
 * The property ladder's **rollup rung**, as a labelled pseudo-metric: total energy =
 * electricity + heat. Only the two kWh carriers — water/wastewater are m³ (a sum would
 * be unit-nonsense) and generation is an output, not a consumption. Not a stored metric:
 * no dataset, snapshot or export ever records it.
 */
export const ENERGY_TOTAL = "energyTotal";

/** The stored carriers {@link ENERGY_TOTAL} sums — the *present* ones (the cube is
 *  sparse: a building carrying only electricity contributes only that). */
export const ENERGY_TOTAL_PARTS: readonly EnergyMetricKey[] = [
  "electricityConsumption",
  "heatConsumption",
];

/**
 * A key the `?m=` axis can carry: a **stored** metric, or the derived total. Wider than
 * `EnergyMetricKey` on purpose — everything that reads/writes the measure axis (the
 * views, the coordinate, the selector) speaks this; everything that reads or writes Pod
 * data keeps the narrow stored type.
 */
export type SelectableMetricKey = EnergyMetricKey | typeof ENERGY_TOTAL;

/** A metric the cube views can be lensed/trended/compared on. */
export interface SelectableMetric {
  key: SelectableMetricKey;
  framing: MetricFraming;
}

/**
 * The selectable measure axis: the four absolute consumption metrics (tier-framed,
 * per-m² intensity), the derived {@link ENERGY_TOTAL} rollup of the two kWh carriers
 * (tier-framed too — it is a consumption, normalised the same way), plus electricity
 * generation (magnitude-framed). The ratio metric (`renewableSelfGeneratedShare`, a %)
 * is deliberately excluded — it is neither an absolute consumption to normalise by area
 * nor a magnitude to rank. Order is the order the selector offers them (the total sits
 * directly under the two carriers it sums); the first (electricity consumption) is the
 * default, matching the map's pre-selector behaviour.
 */
export const SELECTABLE_METRICS: SelectableMetric[] = [
  { key: "electricityConsumption", framing: "tier" },
  { key: "heatConsumption", framing: "tier" },
  { key: ENERGY_TOTAL, framing: "tier" },
  { key: "waterConsumption", framing: "tier" },
  { key: "wastewaterConsumption", framing: "tier" },
  { key: "electricityGeneration", framing: "magnitude" },
];

/** The default selection — electricity consumption (the map's pre-selector lens). */
export const DEFAULT_METRIC: EnergyMetricKey = "electricityConsumption";

const FRAMING_BY_KEY = new Map<SelectableMetricKey, MetricFraming>(
  SELECTABLE_METRICS.map((m) => [m.key, m.framing]),
);

/** Whether `key` is one the views can lens on. */
export function isSelectableMetric(key: string): key is SelectableMetricKey {
  return FRAMING_BY_KEY.has(key as SelectableMetricKey);
}

/**
 * Decode a metric from the URI (`?m=`): the metric itself when it is selectable, else
 * the default — so a stale/shared link with an unknown metric falls back rather than
 * showing a blank view. Mirrors `clampYear` for the year axis.
 */
export function clampMetric(raw: string | null | undefined): SelectableMetricKey {
  return raw != null && isSelectableMetric(raw) ? raw : DEFAULT_METRIC;
}

/** The framing for a metric (`"tier"` for consumption, `"magnitude"` for generation). */
export function metricFraming(key: SelectableMetricKey): MetricFraming {
  return FRAMING_BY_KEY.get(key) ?? "tier";
}

/**
 * The i18n message key for a selectable metric's short label. Returned as a string
 * (an `messages.ts` MessageId) so the widget resolves it through `useT()`; kept here
 * beside the metric definitions so adding a metric updates one place. The derived total
 * resolves the same way (`metricEnergyTotal`) — a labelled cell like any other.
 */
export function metricLabelKey(key: SelectableMetricKey): MessageId {
  return `metric${key.charAt(0).toUpperCase()}${key.slice(1)}` as MessageId;
}

/**
 * The unit a selected metric's **absolute** figures carry (the tier framing divides it
 * by m² on top). Stored metrics take it from the annual-metric schema
 * (`constants/annualMetrics.ts`); the derived total is kWh by construction — it sums
 * only the kWh carriers.
 */
export function metricUnit(key: SelectableMetricKey): string {
  return key === ENERGY_TOTAL ? "kWh" : annualMetricDesc(key)?.unit ?? "";
}

/** A stored figure that can carry a cell: present, finite and positive. */
function positive(raw: number | undefined): number | null {
  return raw != null && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * The **absolute** figure behind a selectable metric in one year's `AnnualMetrics`: the
 * stored figure itself, or — for the derived {@link ENERGY_TOTAL} — the sum of the
 * PRESENT kWh carriers (a building carrying only one contributes that one; `null` when
 * neither is present). The sum happens here, once, so every view and both framings read
 * the same total.
 */
function absoluteAtYear(
  metrics: AnnualMetrics,
  key: SelectableMetricKey,
): number | null {
  if (key !== ENERGY_TOTAL) return positive(metrics[key]);
  let sum = 0;
  let present = false;
  for (const part of ENERGY_TOTAL_PARTS) {
    const v = positive(metrics[part]);
    if (v != null) {
      sum += v;
      present = true;
    }
  }
  return present ? sum : null;
}

/**
 * The per-(building, year) value a cube view reads for the selected metric, from one
 * year's `AnnualMetrics`. `null` when the metric isn't present that year, or the value
 * can't be framed.
 *
 * - **tier (consumption):** the *intensity* — the metric figure divided by the
 *   building's reference floor area (`referenceArea`), kWh/m² (or m³/m²) per year — so
 *   size doesn't masquerade as efficiency (the same proxy `energyCategory.ts` uses).
 *   `null` when there is no usable area or no positive figure. The derived total is
 *   summed FIRST and normalised once — (electricity + heat) / m², not the sum of two
 *   intensities (which is only accidentally the same and drops a carrier's absence).
 * - **magnitude (generation):** the *absolute* figure (kWh), un-normalised — generation
 *   ranks by raw output, not per floor area. `null` when there is no positive figure.
 */
export function metricValueAtYear(
  building: Building,
  metrics: AnnualMetrics | undefined,
  key: SelectableMetricKey,
): number | null {
  if (!metrics) return null;
  const raw = absoluteAtYear(metrics, key);
  if (raw == null) return null;
  if (metricFraming(key) === "magnitude") return raw;
  // tier: per-m² intensity
  const area = referenceArea(building);
  if (area == null || !(area > 0)) return null;
  return raw / area;
}

/**
 * The unit a cube view labels {@link metricValueAtYear}'s result with — the canonical
 * unit for a magnitude framing (`"kWh"`), the per-area annual intensity for a tier
 * framing (`"kWh/m²/a"`, `"m³/m²/a"`). Derived from the annual-metric schema, so water
 * and wastewater read m³ rather than the kWh a hardcoded string used to print.
 */
export function metricValueUnit(key: SelectableMetricKey): string {
  const unit = annualMetricDesc(key)?.unit ?? "kWh";
  return metricFraming(key) === "magnitude" ? unit : `${unit}/m²/a`;
}

/**
 * The **absolute** figure of a metric in one year's `AnnualMetrics` (no per-area
 * normalisation), or `null` when absent / non-positive. The energy × weather overlay
 * plots absolute energy against temperature, so it reads this rather than the
 * framing-dependent `metricValueAtYear` (which would per-m² a consumption metric).
 * The derived total is the raw sum of its present carriers, un-normalised.
 */
export function metricRawAtYear(
  metrics: AnnualMetrics | undefined,
  key: SelectableMetricKey,
): number | null {
  return metrics ? absoluteAtYear(metrics, key) : null;
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

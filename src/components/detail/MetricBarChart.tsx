import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_AXIS_TICK_COLOR, CHART_GRID_COLOR } from "../../constants/chartColors.ts";

/**
 * A small SVG bar chart (Recharts) for the energy detail views — one or more
 * series (e.g. actual + planned/Soll) over a category axis. SVG (not canvas), so
 * the bars, axis ticks and legend are real DOM and assertable in e2e.
 *
 * A bar may carry a `palette` to colour each category bar differently (the
 * single-series, multi-colour case — e.g. the per-energy-type breakdown); the
 * palette cycles over the rows.
 */
export interface MetricBar {
  key: string;
  name: string;
  color: string;
  palette?: string[];
}

export interface MetricBarChartProps {
  /** Row per category; each row has `xKey` plus a numeric value per bar `key`. */
  data: Array<Record<string, string | number>>;
  bars: MetricBar[];
  xKey?: string;
  /** Y-axis unit label (e.g. "kWh", "m³", "%"). */
  yUnit?: string;
  height?: number;
  /** Hide the legend (single-series charts don't need it). */
  hideLegend?: boolean;
}

export default function MetricBarChart(
  { data, bars, xKey = "year", yUnit, height = 260, hideLegend }:
    MetricBarChartProps,
) {
  // Tufte data-ink: faint horizontal reference lines only (no vertical grid), and no
  // axis/tick lines — the tick labels alone read the scale. Bars keep their honest 0
  // baseline (Recharts' default for the value axis).
  const tick = { fill: CHART_AXIS_TICK_COLOR };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid vertical={false} stroke={CHART_GRID_COLOR} />
        <XAxis dataKey={xKey} axisLine={false} tickLine={false} tick={tick} />
        <YAxis
          width={56}
          axisLine={false}
          tickLine={false}
          tick={tick}
          label={yUnit
            ? {
              value: yUnit,
              angle: -90,
              position: "insideLeft",
              fill: CHART_AXIS_TICK_COLOR,
            }
            : undefined}
        />
        <Tooltip />
        {!hideLegend && <Legend />}
        {bars.map((b) => (
          <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color}>
            {b.palette &&
              data.map((_, i) => (
                <Cell key={i} fill={b.palette![i % b.palette!.length]} />
              ))}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

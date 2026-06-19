import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_AXIS_TICK_COLOR, CHART_GRID_COLOR } from "../../constants/chartColors.ts";

/**
 * A small SVG line chart (Recharts) — the line sibling of {@link MetricBarChart}
 * for the time-series energy views (day profile, average profile). SVG, so the
 * points/axes are real DOM and assertable in e2e. Gaps (`null` values) are
 * connected so a sparse series still reads as one line.
 */
export interface MetricLineChartProps {
  /** Row per point; each row has `xKey` plus a numeric value per line `key`. */
  data: Array<Record<string, string | number | null>>;
  lines: Array<{ key: string; name: string; color: string }>;
  xKey?: string;
  /** Y-axis unit label (e.g. "kWh"). */
  yUnit?: string;
  height?: number;
  /** Hide the legend (single-series charts don't need it). */
  hideLegend?: boolean;
}

export default function MetricLineChart(
  { data, lines, xKey = "t", yUnit, height = 260, hideLegend }:
    MetricLineChartProps,
) {
  // Tufte data-ink: faint horizontal reference lines only (no vertical grid), no
  // axis/tick lines — the line + tick labels carry the data.
  const tick = { fill: CHART_AXIS_TICK_COLOR };
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
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
        {lines.map((l) => (
          <Line
            key={l.key}
            type="monotone"
            dataKey={l.key}
            name={l.name}
            stroke={l.color}
            dot={{ r: 2 }}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

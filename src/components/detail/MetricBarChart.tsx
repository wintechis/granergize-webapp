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
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} />
        <YAxis
          width={70}
          label={yUnit
            ? { value: yUnit, angle: -90, position: "insideLeft" }
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

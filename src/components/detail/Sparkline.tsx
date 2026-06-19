import { Box } from "@mui/material";
import { Line, LineChart, ResponsiveContainer } from "recharts";

/**
 * A Tufte sparkline — a word-sized, axis-less trend line for inline use in a
 * summary line or table cell. No grid, axes, ticks, tooltip or legend: pure
 * data-ink, just the shape of the series. Renders nothing for fewer than two
 * points (no trend to show). Colour defaults to the inherited text colour.
 */
export default function Sparkline(
  { values, color = "currentColor", width = 96, height = 26 }: {
    values: number[];
    color?: string;
    width?: number | string;
    height?: number;
  },
) {
  if (values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <Box
      sx={{ width, height, display: "inline-block", verticalAlign: "middle" }}
      aria-hidden
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
          <Line
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}

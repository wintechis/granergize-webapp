import {
  Alert,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@mui/material";
import type {
  AggregationDefinition,
  AggregationSnapshot,
} from "../../types.ts";
import { ChartBox, SectionTitle } from "../detail/DetailView.tsx";
import MetricBarChart from "../detail/MetricBarChart.tsx";
import { CHART_COLOR_PALETTE } from "../../constants/chartColors.ts";
import { annualMetricLabel } from "../../constants/annualMetrics.ts";
import { formatNumber } from "../../lib/formatNumber.ts";
import { formatError } from "../../lib/formatError.ts";

/** Capitalise the first letter (e.g. "average" → "Average"). */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The aggregation page's Results section: the computed snapshot rendered as a
 * bar chart + values table, or an explanatory state — an empty snapshot
 * (Alert info), or no snapshot yet / a compute failure (Alert warning) prompting
 * a Refresh.
 */
export default function AggregationResultsSection(
  { definition, snapshot, computeError }: {
    definition: AggregationDefinition;
    snapshot: AggregationSnapshot | null;
    computeError?: unknown;
  },
) {
  // Human metric labels (with units) from the shared annual-metric schema —
  // never the raw camelCase identifier.
  const chartRows = snapshot
    ? Object.entries(snapshot.values).map(([metric, value]) => ({
      name: annualMetricLabel(metric),
      value,
    }))
    : [];
  const aggregationLabel = `${capitalize(definition.aggregationType)} Values`;

  return (
    <Box>
      <SectionTitle>Results</SectionTitle>
      <Box sx={{ mt: 1 }}>
        {snapshot && chartRows.length === 0 && (
          // A snapshot can legitimately compute to NO values — the selected
          // metrics are absent from every included building, or the chosen month
          // has no readings. Say so instead of rendering bare empty axes
          // (heike-4's "empty diagram"). Inline persistent state → Alert.
          <Alert severity="info">
            The computed summary contains no values: none of the included
            buildings carry data for the selected metrics
            {definition.period ? " in the selected month" : ""}. Enter energy
            data for them (or adjust the aggregation), then refresh the snapshot.
          </Alert>
        )}

        {snapshot && chartRows.length > 0 && (
          <>
            <ChartBox>
              <Box sx={{ height: 400 }}>
                <MetricBarChart
                  data={chartRows}
                  bars={[{
                    key: "value",
                    name: aggregationLabel,
                    color: CHART_COLOR_PALETTE[0],
                    palette: CHART_COLOR_PALETTE,
                  }]}
                  xKey="name"
                  yUnit={definition.period ? "kWh/month" : "kWh"}
                  height={400}
                  hideLegend
                />
              </Box>
            </ChartBox>

            <TableContainer sx={{ mt: 2 }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Metric</TableCell>
                    <TableCell align="right">
                      {/* Units live in the per-metric row labels — a flat
                          "(kWh)" here lied for the m³ and % metrics. */}
                      {capitalize(definition.aggregationType)} Value
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {Object.entries(snapshot.values).map(([metric, value]) => (
                    <TableRow key={metric}>
                      <TableCell component="th" scope="row">
                        {annualMetricLabel(metric)}
                      </TableCell>
                      <TableCell align="right">
                        {formatNumber(value, 2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}

        {!snapshot && (
          <>
            {computeError != null && (
              // The auto-compute on first open failed (the load itself
              // succeeded) — persistent in-place state → Alert; "Refresh" is
              // the retry affordance.
              <Alert severity="warning" sx={{ mb: 2 }}>
                {formatError("actionComputeAggregation", computeError)}
              </Alert>
            )}
            <Alert severity="warning">
              No snapshot computed yet. Click "Refresh" to compute aggregated
              values.
            </Alert>
          </>
        )}
      </Box>
    </Box>
  );
}

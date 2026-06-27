/**
 * The Aggregations finder's TIMELINE guise (plan-aggregations Slice 5): the collection's chosen
 * metric across the years, as trend lines.
 *
 * - **Own** aggregations: a line per aggregation, computed on the fly from the members' per-year
 *   annual datasets (`computeAggregationSeries`) — no stored per-year snapshot history needed.
 * - **Open** datasets: a line per region, from the regionalstatistik year series.
 * - **Received** aggregations: a single point (the shared snapshot is one year; the foreign members'
 *   yearly data isn't reachable).
 *
 * A metric selector (energy metrics from the aggregations + the open regionalstatistik tables) picks
 * the measure; lines are drawn over a shared year axis. Tiers are folded per the tier filter.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, MenuItem, Stack, TextField, Typography } from "@mui/material";
import type { AggregationDefinition } from "../../types.ts";
import type { ReceivedAggregation } from "../../services/interop/sharing.ts";
import type { OpenRegionalItem } from "../../services/sources/openRegional.ts";
import { computeAggregationSeries } from "../../services/aggregation/aggregationComputer.ts";
import { loadComputedSnapshot } from "../../services/aggregation/aggregation.ts";
import {
  fetchRegionalObservations,
  REGIONAL_TABLES,
} from "../../services/sources/regionalCube.ts";
import { annualMetricLabel } from "../../constants/annualMetrics.ts";
import { CHART_COLOR_PALETTE } from "../../constants/chartColors.ts";
import { mapPooled } from "../../lib/pool.ts";
import { getGateway } from "../../hooks/session.ts";
import MetricLineChart from "../detail/MetricLineChart.tsx";
import { useT } from "../../context/I18nProvider.tsx";

const HOUR = 60 * 60 * 1000;

interface Series {
  key: string;
  name: string;
  points: { year: number; value: number }[];
}

type Choice =
  | { id: string; label: string; kind: "energy"; metric: string }
  | { id: string; label: string; kind: "regional"; tableId: string };

export default function AggregationsTimeline(
  { definitions, received, openItems }: {
    definitions: AggregationDefinition[];
    received: ReceivedAggregation[];
    openItems: OpenRegionalItem[];
  },
) {
  const t = useT();

  // Energy metrics come from the own definitions; the open tables are their own measures.
  const energyMetrics = [...new Set(definitions.flatMap((d) => d.metrics))].sort();
  const openTableIds = [...new Set(openItems.map((o) => o.tableId))];
  const choices: Choice[] = [
    ...energyMetrics.map((m): Choice => ({
      id: `e:${m}`,
      label: annualMetricLabel(m),
      kind: "energy",
      metric: m,
    })),
    ...openTableIds.flatMap((tableId): Choice[] => {
      const table = REGIONAL_TABLES.find((tb) => tb.tableId === tableId);
      return table ? [{ id: `r:${tableId}`, label: t(table.labelId), kind: "regional", tableId }] : [];
    }),
  ];
  const [choiceId, setChoiceId] = useState("");
  const active = choices.find((c) => c.id === choiceId) ?? choices[0];

  // `active.id` fully identifies the chosen metric; the object ref churns each render, so the
  // stable id (not `active` itself) is the queryKey.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const series = useQuery({
    queryKey: [
      "aggTimeline",
      active?.id,
      definitions.map((d) => d.id).sort(),
      received.map((r) => r.snapshotUri).sort(),
      openItems.map((o) => o.id).sort(),
    ],
    enabled: !!active,
    staleTime: HOUR,
    queryFn: async (): Promise<Series[]> => {
      if (!active) return [];
      if (active.kind === "regional") {
        const table = REGIONAL_TABLES.find((tb) => tb.tableId === active.tableId)!;
        const regions = openItems.filter((o) => o.tableId === active.tableId);
        const lines = await mapPooled(regions, 4, async (o): Promise<Series | null> => {
          const obs = await fetchRegionalObservations(table, o.ags).catch(() => []);
          return obs.length
            ? { key: `open:${o.ags}`, name: o.region, points: obs.map((x) => ({ year: x.year, value: x.value })) }
            : null;
        });
        return lines.filter((s): s is Series => s !== null);
      }
      // Energy: own aggregations computed per year, received as a single point.
      const metric = active.metric;
      const own = await mapPooled(
        definitions.filter((d) => d.metrics.includes(metric)),
        4,
        async (d): Promise<Series | null> => {
          const points = await computeAggregationSeries(getGateway(), d, metric);
          return points.length ? { key: `own:${d.id}`, name: d.name, points } : null;
        },
      );
      const recv = await mapPooled(received, 4, async (r): Promise<Series | null> => {
        const snap = await loadComputedSnapshot(getGateway(), r.snapshotUri).catch(() => null);
        const value = snap?.values[metric];
        if (snap == null || value == null) return null;
        const year = snap.metricPeriod
          ? Number(snap.metricPeriod)
          : new Date(snap.computedAt).getFullYear();
        if (Number.isNaN(year)) return null;
        return { key: `recv:${r.aggregationId}`, name: snap.name || r.aggregationId, points: [{ year, value }] };
      });
      return [...own, ...recv].filter((s): s is Series => s !== null);
    },
  });
  const lines = series.data ?? [];

  if (choices.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {t("aggTimelineEmpty")}
      </Typography>
    );
  }

  // Merge the series into rows keyed by year for the multi-line chart.
  const years = [...new Set(lines.flatMap((s) => s.points.map((p) => p.year)))].sort((a, b) => a - b);
  const rows = years.map((year) => {
    const row: Record<string, string | number | null> = { year: String(year) };
    for (const s of lines) {
      const pt = s.points.find((p) => p.year === year);
      if (pt) row[s.key] = pt.value;
    }
    return row;
  });
  const chartLines = lines.map((s, i) => ({
    key: s.key,
    name: s.name,
    color: CHART_COLOR_PALETTE[i % CHART_COLOR_PALETTE.length],
  }));

  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      {active && (
        <TextField
          select
          size="small"
          label={t("aggMapMetricLabel")}
          value={active.id}
          onChange={(e) => setChoiceId(e.target.value)}
          sx={{ minWidth: 240, alignSelf: "flex-start" }}
        >
          {choices.map((c) => (
            <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>
          ))}
        </TextField>
      )}
      {rows.length === 0
        ? (
          <Typography variant="body2" color="text.secondary">
            {t("aggTimelineNoData")}
          </Typography>
        )
        : (
          <Box>
            <MetricLineChart data={rows} lines={chartLines} xKey="year" height={320} />
          </Box>
        )}
    </Stack>
  );
}

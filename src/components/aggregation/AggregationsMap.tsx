/**
 * The Aggregations finder's MAP guise (plan-aggregations Slice 4): the collection shaded onto the
 * German choropleth by a **chosen metric**, folding all three tiers onto one map.
 *
 * - **Own + received** aggregations contribute their snapshot's per-metric `values`, placed at
 *   their region's 5-digit **Kreis** (`spatialExtent` from Slice 2); several in one Kreis average.
 * - **Open** datasets contribute the public `linked-regionalstatistik` figures at **Bundesland**
 *   (Land) grain — a different measure family, so they appear as their own entries in the metric
 *   selector.
 *
 * The selector lists every available measure (energy metrics from the aggregations + the open
 * tables); the active one decides the grain (Kreis vs Land), the geometry layer, and the value
 * source. Aggregations with no region / no value for the active metric are listed as "not placed".
 * Reuses the shared `MagnitudeChoroplethLayer` + magnitude lens.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { MapContainer, WMSTileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { AggregationDefinition } from "../../types.ts";
import type { ReceivedAggregation } from "../../services/interop/sharingManager.ts";
import type { OpenRegionalItem } from "../../services/openRegional.ts";
import {
  fetchRegionGeometry,
  type RegionFeatureProps,
  type RegionGrain,
} from "../../services/regionGeometry.ts";
import {
  getComputedSnapshotByAggregationId,
  loadComputedSnapshot,
} from "../../services/aggregation/aggregationManager.ts";
import {
  fetchRegionalChoropleth,
  REGIONAL_TABLES,
  type RegionalObservation,
} from "../../services/regionalCube.ts";
import { kreisAgsOf } from "../../services/aggregation/regionRollup.ts";
import { magnitudeCategoriserFor } from "../../services/energy/energyMetric.ts";
import { annualMetricLabel } from "../../constants/annualMetrics.ts";
import { mapPooled } from "../../lib/pool.ts";
import { getGateway } from "../../hooks/session.ts";
import { BASEMAP_DE } from "../../lib/orthophoto.ts";
import MagnitudeChoroplethLayer from "../region/MagnitudeChoroplethLayer.tsx";
import MagnitudeLegend from "../region/MagnitudeLegend.tsx";
import { useT } from "../../context/I18nProvider.tsx";

const FRAMING = "magnitude" as const;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const EMPTY_REGIONAL = new Map<string, RegionalObservation>();

/** An own/received aggregation reduced to what the map needs. */
interface MapSnapshot {
  name: string;
  kreis: string | null;
  values: Record<string, number>;
}

/** A selectable measure: an energy metric (Kreis grain, from snapshots) or an open
 *  regionalstatistik table (Land grain, from the cube). */
type MetricChoice =
  | { id: string; label: string; kind: "energy"; metric: string }
  | { id: string; label: string; kind: "regional"; tableId: string };

export default function AggregationsMap(
  { definitions, received, openItems }: {
    definitions: AggregationDefinition[];
    received: ReceivedAggregation[];
    openItems: OpenRegionalItem[];
  },
) {
  const t = useT();

  // Own + received snapshots (region + per-metric values). Keyed by the stable id/uri set;
  // per-item tolerant so one unreadable snapshot doesn't sink the map.
  const snaps = useQuery({
    queryKey: [
      "aggMapSnapshots",
      definitions.map((d) => d.id).sort(),
      received.map((r) => r.snapshotUri).sort(),
    ],
    enabled: definitions.length + received.length > 0,
    staleTime: HOUR,
    queryFn: async (): Promise<MapSnapshot[]> => {
      const own = await mapPooled(definitions, 4, async (def): Promise<MapSnapshot | null> => {
        const snap = await getComputedSnapshotByAggregationId(getGateway(), def.id)
          .catch(() => null);
        return snap ? { name: def.name, kreis: kreisAgsOf(snap.spatialExtent), values: snap.values } : null;
      });
      const recv = await mapPooled(received, 4, async (r): Promise<MapSnapshot | null> => {
        const snap = await loadComputedSnapshot(getGateway(), r.snapshotUri).catch(() => null);
        return snap
          ? { name: snap.name || r.aggregationId, kreis: kreisAgsOf(snap.spatialExtent), values: snap.values }
          : null;
      });
      return [...own, ...recv].filter((s): s is MapSnapshot => s !== null);
    },
  });
  const loaded = snaps.data ?? [];

  // The measure menu: energy metrics across the snapshots + the distinct open tables.
  const energyMetrics = [...new Set(loaded.flatMap((s) => Object.keys(s.values)))].sort();
  const openTableIds = [...new Set(openItems.map((o) => o.tableId))];
  const choices: MetricChoice[] = [
    ...energyMetrics.map((m): MetricChoice => ({
      id: `e:${m}`,
      label: annualMetricLabel(m),
      kind: "energy",
      metric: m,
    })),
    ...openTableIds.flatMap((tableId): MetricChoice[] => {
      const table = REGIONAL_TABLES.find((tb) => tb.tableId === tableId);
      return table ? [{ id: `r:${tableId}`, label: t(table.labelId), kind: "regional", tableId }] : [];
    }),
  ];
  const [choiceId, setChoiceId] = useState("");
  const active = choices.find((c) => c.id === choiceId) ?? choices[0];

  const grain: RegionGrain = active?.kind === "regional" ? "land" : "kreis";

  // Energy path: average the chosen metric per Kreis; track the unplaced.
  const byKreis = new Map<string, { sum: number; n: number }>();
  const unplaced: string[] = [];
  if (active?.kind === "energy") {
    for (const s of loaded) {
      const v = s.values[active.metric];
      if (!s.kreis || v == null) {
        unplaced.push(s.name);
        continue;
      }
      const e = byKreis.get(s.kreis) ?? { sum: 0, n: 0 };
      e.sum += v;
      e.n += 1;
      byKreis.set(s.kreis, e);
    }
  }
  const avg = (e: { sum: number; n: number }) => e.sum / e.n;

  // Regional (open) path: the whole-country figures for the chosen table (one fetch).
  const regionalTable = active?.kind === "regional"
    ? REGIONAL_TABLES.find((tb) => tb.tableId === active.tableId)
    : undefined;
  const regional = useQuery({
    queryKey: ["regionalChoropleth", regionalTable?.tableId, regionalTable],
    enabled: !!regionalTable,
    staleTime: HOUR,
    queryFn: () => fetchRegionalChoropleth(regionalTable!),
  });
  const regionalMap = regional.data ?? EMPTY_REGIONAL;

  const geo = useQuery({
    queryKey: ["regionGeometry", grain, null],
    queryFn: () => fetchRegionGeometry(grain),
    staleTime: DAY,
    // Best-effort decorative overlay: a wrapper outage drops the choropleth, never toasts.
    meta: { silent: true },
  });
  const fc = geo.data;

  const values = active?.kind === "regional"
    ? [...regionalMap.values()].map((o) => o.value)
    : [...byKreis.values()].map(avg);
  const classify = magnitudeCategoriserFor(values);

  const bandOf = (p: RegionFeatureProps) => {
    if (active?.kind === "regional") {
      const o = regionalMap.get(p.ags);
      return o ? classify(o.value) : "none";
    }
    const e = byKreis.get(p.ags);
    return e ? classify(avg(e)) : "none";
  };
  const tooltip = (p: RegionFeatureProps) => {
    const head = `<strong>${p.label || p.code || ""}</strong>`;
    if (active?.kind === "regional") {
      const o = regionalMap.get(p.ags);
      return o
        ? `${head}<br/>${o.value.toLocaleString("de-DE")} ${o.unit} (${o.year})`
        : `${head}<br/>${t("lensBandNoData")}`;
    }
    const e = byKreis.get(p.ags);
    return e
      ? `${head}<br/>${annualMetricLabel(active!.metric)}: ${
        avg(e).toLocaleString("de-DE", { maximumFractionDigits: 0 })
      }${e.n > 1 ? ` (⌀ ${e.n})` : ""}`
      : `${head}<br/>${t("lensBandNoData")}`;
  };

  if (definitions.length + received.length + openItems.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {t("aggMapEmpty")}
      </Typography>
    );
  }

  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      {choices.length > 0 && active && (
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
      <Box
        sx={{
          position: "relative",
          aspectRatio: "16 / 9",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        <MapContainer center={[51.1, 10.4]} zoom={6} style={{ height: "100%" }}>
          <WMSTileLayer
            url={BASEMAP_DE.url}
            layers={BASEMAP_DE.layers}
            format="image/png"
            attribution={BASEMAP_DE.attribution}
          />
          {fc && (
            <MagnitudeChoroplethLayer
              data={fc}
              bandOf={bandOf}
              tooltip={tooltip}
              framing={FRAMING}
              remountKey={`${grain}:${active?.id ?? ""}`}
              styleVersion={regionalMap.size + byKreis.size}
            />
          )}
        </MapContainer>
        <MagnitudeLegend framing={FRAMING} />
      </Box>
      {active?.kind === "energy" && unplaced.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          {t("aggMapUnplaced", { count: unplaced.length })} {unplaced.join(", ")}
        </Typography>
      )}
    </Stack>
  );
}

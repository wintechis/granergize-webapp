/**
 * The Aggregations finder's MAP guise (plan-aggregations Slice 4): your own aggregations shaded
 * onto the German **Kreis** choropleth by the number of buildings each aggregates. Each
 * aggregation's region is resolved from its building set via the point-in-region lookup
 * (`resolveSpatialExtent` → linked-lau `/contains`), projected to its 5-digit Kreis; aggregations
 * with no shared region (an ad-hoc set spanning Kreise) — or only a Bundesland — are listed below
 * the map as "not placed". Reuses the shared `MagnitudeChoroplethLayer` + magnitude lens.
 *
 * First cut: own tier, measured by building count (no snapshot loads). Shading by an energy metric
 * and folding the received/open tiers are later steps.
 */
import { useQuery } from "@tanstack/react-query";
import { Box, Stack, Typography } from "@mui/material";
import { MapContainer, WMSTileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { AggregationDefinition } from "../../types.ts";
import {
  fetchRegionGeometry,
  type RegionFeatureProps,
} from "../../services/regionGeometry.ts";
import { resolveSpatialExtent } from "../../services/aggregation/aggregationComputer.ts";
import { kreisAgsOf } from "../../services/aggregation/regionRollup.ts";
import { magnitudeCategoriserFor } from "../../services/energy/energyMetric.ts";
import { mapPooled } from "../../lib/pool.ts";
import { BASEMAP_DE } from "../../lib/orthophoto.ts";
import MagnitudeChoroplethLayer from "../region/MagnitudeChoroplethLayer.tsx";
import MagnitudeLegend from "../region/MagnitudeLegend.tsx";
import { useT } from "../../context/I18nProvider.tsx";

const FRAMING = "magnitude" as const;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export default function AggregationsMap(
  { definitions }: { definitions: AggregationDefinition[] },
) {
  const t = useT();

  // Resolve each own aggregation's region from its building set (cached coords + /contains),
  // keyed by the stable set of aggregation ids so it re-runs only when the set changes.
  const regions = useQuery({
    queryKey: ["aggKreisRegions", definitions.map((d) => d.id).sort()],
    enabled: definitions.length > 0,
    staleTime: HOUR,
    queryFn: () =>
      mapPooled(definitions, 4, async (def) => ({
        def,
        kreis: kreisAgsOf(await resolveSpatialExtent(def.buildingUris)),
      })),
  });
  const resolved = regions.data ?? [];

  // Tally buildings per Kreis; aggregations with no Kreis fall to the "not placed" list.
  const byKreis = new Map<string, { aggs: number; buildings: number }>();
  const unplaced: AggregationDefinition[] = [];
  for (const { def, kreis } of resolved) {
    if (!kreis) {
      unplaced.push(def);
      continue;
    }
    const e = byKreis.get(kreis) ?? { aggs: 0, buildings: 0 };
    e.aggs += 1;
    e.buildings += def.buildingUris.length;
    byKreis.set(kreis, e);
  }

  const geo = useQuery({
    queryKey: ["regionGeometry", "kreis", null],
    queryFn: () => fetchRegionGeometry("kreis"),
    staleTime: DAY,
  });
  const fc = geo.data;

  const classify = magnitudeCategoriserFor(
    [...byKreis.values()].map((e) => e.buildings),
  );
  const bandOf = (p: RegionFeatureProps) => {
    const e = byKreis.get(p.ags);
    return e ? classify(e.buildings) : "none";
  };
  const tooltip = (p: RegionFeatureProps) => {
    const head = `<strong>${p.label || p.code || ""}</strong>`;
    const e = byKreis.get(p.ags);
    return e
      ? `${head}<br/>${t("aggMapTooltip", { aggs: e.aggs, buildings: e.buildings })}`
      : `${head}<br/>${t("lensBandNoData")}`;
  };

  if (definitions.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {t("aggMapEmpty")}
      </Typography>
    );
  }

  return (
    <Stack spacing={1} sx={{ mt: 1 }}>
      <Box
        sx={{
          position: "relative",
          height: 480,
          borderRadius: 1,
          overflow: "hidden",
          border: 1,
          borderColor: "divider",
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
              remountKey="kreis"
              styleVersion={byKreis.size}
            />
          )}
        </MapContainer>
        <MagnitudeLegend framing={FRAMING} />
      </Box>
      {unplaced.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          {t("aggMapUnplaced", { count: unplaced.length })}{" "}
          {unplaced.map((d) => d.name).join(", ")}
        </Typography>
      )}
    </Stack>
  );
}

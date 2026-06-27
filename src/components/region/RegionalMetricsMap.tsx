/**
 * Regional-statistics choropleth — German **Bundesland ⇄ Kreis** regions (from
 * `linked-nuts`, fetched whole) shaded by a chosen `linked-regionalstatistik` metric.
 * Zoom-driven level of detail: Bundesländer when zoomed out, Kreise at mid zoom (the
 * user drives the viewport; the map never recenters itself). A metric dropdown picks
 * the measure for the current grain.
 *
 * Reusable, with an optional initial `center`/`zoom` and pre-selected metric:
 * - **embedded** on a building's observation page, anchored on its region — the map
 *   sibling of the {@link ./../observation/RegionalContextSection.tsx} figures table;
 * - on the **`RegionalDataset`** page (the Aggregations `open` tier → `/regional`),
 *   shading the opened dataset's metric across all regions.
 *
 * The Gemeinde grain lives in {@link ./../observation/NeighbourhoodEnergyMap.tsx}
 * (Energie-Atlas) — this map is the statistics half.
 */
import { useState } from "react";
import { MapContainer, Marker, WMSTileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { useQuery } from "@tanstack/react-query";
import { Box, MenuItem, Select, Stack, Typography } from "@mui/material";
import {
  fetchRegionGeometry,
  type RegionFeatureProps,
  type RegionGrain,
} from "../../services/sources/regionGeometry.ts";
import {
  fetchRegionalChoropleth,
  REGIONAL_TABLES,
  type RegionalObservation,
} from "../../services/sources/regionalCube.ts";
import { magnitudeCategoriserFor } from "../../services/energy/energyMetric.ts";
import { BASEMAP_DE } from "../../lib/orthophoto.ts";
import { buildingPin } from "../../lib/buildingPin.ts";
import MagnitudeChoroplethLayer from "./MagnitudeChoroplethLayer.tsx";
import MagnitudeLegend from "./MagnitudeLegend.tsx";
import ViewWatch from "./ViewWatch.tsx";
import { useT } from "../../context/I18nProvider.tsx";

const FRAMING = "magnitude" as const;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ZOOM_KREIS = 7; // ≥ this → Kreis, else Bundesland
const EMPTY = new Map<string, RegionalObservation>();

function metricGrainForZoom(zoom: number): RegionGrain {
  return zoom >= ZOOM_KREIS ? "kreis" : "land";
}

export default function RegionalMetricsMap(
  { center = [51.1, 10.4], zoom = 6, initialTableId, marker }: {
    center?: [number, number];
    zoom?: number;
    /** Pre-select this metric for its grain (e.g. the dataset a page opened). */
    initialTableId?: string;
    /** A building's location pin, when the map is anchored on one (omitted for the
     *  generic region browse). */
    marker?: { lat: number; long: number; shared?: boolean };
  },
) {
  const t = useT();
  const [liveZoom, setLiveZoom] = useState(zoom);
  // The chosen metric per grain (Land / Kreis), seeded from `initialTableId`.
  const [selectedId, setSelectedId] = useState<Record<string, string>>(() => {
    const seed = initialTableId
      ? REGIONAL_TABLES.find((tab) => tab.tableId === initialTableId)
      : undefined;
    return seed ? { [seed.grain]: seed.tableId } : {};
  });

  const grain = metricGrainForZoom(liveZoom);
  const choices = REGIONAL_TABLES.filter((tab) => tab.grain === grain);
  const table = choices.find((tab) => tab.tableId === selectedId[grain]) ?? choices[0];

  // Geometry (whole German layer at this level) + the chosen table's values.
  const geo = useQuery({
    queryKey: ["regionGeometry", grain, null],
    queryFn: () => fetchRegionGeometry(grain),
    staleTime: DAY,
    // Best-effort decorative overlay: a wrapper outage drops the choropleth, never toasts.
    meta: { silent: true },
  });
  const fc = geo.data;
  const values = useQuery({
    queryKey: ["regionalChoropleth", table.tableId, table],
    queryFn: () => fetchRegionalChoropleth(table),
    staleTime: HOUR,
  });
  const regionalMap = values.data ?? EMPTY;

  const classify = magnitudeCategoriserFor(
    [...regionalMap.values()].map((o) => o.value),
  );
  const bandOf = (p: RegionFeatureProps) => {
    const v = regionalMap.get(p.ags)?.value;
    return v != null ? classify(v) : "none";
  };
  const tooltip = (p: RegionFeatureProps) => {
    const head = `<strong>${p.label || p.code || ""}</strong>`;
    const o = regionalMap.get(p.ags);
    return o
      ? `${head}<br/>${o.value.toLocaleString("de-DE")} ${o.unit} (${o.year})`
      : `${head}<br/>${t("lensBandNoData")}`;
  };

  return (
    <Stack spacing={1} sx={{ height: "100%", minHeight: 0 }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <Typography variant="h6">{t("choroplethTitle")}</Typography>
        <Typography variant="body2">
          {grain === "kreis" ? t("choroplethLevelKreis") : t("choroplethLevelLand")}
        </Typography>
        <Select
          size="small"
          value={table.tableId}
          onChange={(e) =>
            setSelectedId((s) => ({ ...s, [grain]: e.target.value }))}
          sx={{ minWidth: 260 }}
        >
          {choices.map((tab) => (
            <MenuItem key={tab.tableId} value={tab.tableId}>
              {t(tab.labelId)}
            </MenuItem>
          ))}
        </Select>
        <Typography variant="body2" color="text.secondary">
          {t("choroplethZoomHint")}
        </Typography>
      </Stack>
      <Box
        sx={{ position: "relative", flex: 1, minHeight: 0, borderRadius: 1, overflow: "hidden" }}
      >
        <MapContainer center={center} zoom={zoom} style={{ height: "100%" }}>
          <WMSTileLayer
            url={BASEMAP_DE.url}
            layers={BASEMAP_DE.layers}
            format="image/png"
            attribution={BASEMAP_DE.attribution}
          />
          <ViewWatch onChange={(z) => setLiveZoom(z)} />
          {marker && (
            <Marker
              position={[marker.lat, marker.long]}
              icon={buildingPin(marker.shared ?? false)}
              interactive={false}
            />
          )}
          {fc && (
            <MagnitudeChoroplethLayer
              data={fc}
              bandOf={bandOf}
              tooltip={tooltip}
              framing={FRAMING}
              remountKey={grain}
              styleVersion={regionalMap.size}
            />
          )}
        </MapContainer>
        <MagnitudeLegend framing={FRAMING} />
      </Box>
    </Stack>
  );
}

/**
 * The region an aggregation covers, highlighted on the German choropleth (plan-aggregations). The
 * aggregation's spatial extent (its `skos:Concept` region) is shaded on the Bundesland or Kreis
 * layer and the map fits to it; a national (`bund`) extent highlights the whole country. Reuses the
 * shared `MagnitudeChoroplethLayer` — here as a single-region highlight, not a magnitude scale.
 */
import { useEffect, useMemo } from "react";
import { Box, Stack, Typography } from "@mui/material";
import MapIcon from "@mui/icons-material/Map";
import { MapContainer, useMap, WMSTileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useQuery } from "@tanstack/react-query";
import type { SpatialExtent } from "../../types.ts";
import {
  fetchRegionGeometry,
  type RegionFeatureProps,
  type RegionGrain,
} from "../../services/sources/regionGeometry.ts";
import { BASEMAP_DE } from "../../lib/orthophoto.ts";
import MagnitudeChoroplethLayer from "../region/MagnitudeChoroplethLayer.tsx";
import { useT } from "../../context/I18nProvider.tsx";

const DAY = 24 * 60 * 60 * 1000;

/** Flatten a GeoJSON Polygon/MultiPolygon's nested coordinates to [lat, lon] points. */
function toPoints(coords: unknown, out: [number, number][]): void {
  if (!Array.isArray(coords)) return;
  if (
    coords.length === 2 && typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    out.push([coords[1], coords[0]]); // [lon, lat] → [lat, lon]
    return;
  }
  for (const c of coords) toPoints(c, out);
}

/** Fit the view to the highlighted region whenever its point set changes. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    map.fitBounds(L.latLngBounds(points), { padding: [16, 16], maxZoom: 11 });
  }, [map, points]);
  return null;
}

export default function AggregationRegionMap(
  { extent }: { extent: SpatialExtent },
) {
  const t = useT();
  const code = extent.region.match(/\/ags\/(\d+)$/)?.[1] ?? null;
  // Land + national show the Bundesland layer; Gemeinde/Kreis the Kreis layer.
  const grain: RegionGrain = extent.level === "kreis" || extent.level === "gemeinde"
    ? "kreis"
    : "land";
  const target = code == null
    ? null
    : grain === "kreis"
    ? code.slice(0, 5)
    : code.slice(0, 2);

  const geo = useQuery({
    queryKey: ["regionGeometry", grain, null],
    queryFn: () => fetchRegionGeometry(grain),
    staleTime: DAY,
    // Best-effort decorative overlay: a wrapper outage drops the choropleth, never toasts.
    meta: { silent: true },
  });
  const fc = geo.data;

  // National extent has no single AGS → highlight every region (the whole country).
  const isHighlighted = (p: RegionFeatureProps) =>
    extent.level === "bund" || p.ags === target;

  const points = useMemo(() => {
    const out: [number, number][] = [];
    if (fc) {
      for (const f of fc.features) {
        if (isHighlighted(f.properties)) toPoints(f.geometry.coordinates, out);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fc, target, extent.level]);

  const bandOf = (p: RegionFeatureProps) => (isHighlighted(p) ? "high" : "none");
  const tooltip = (p: RegionFeatureProps) => `<strong>${p.label || p.code || ""}</strong>`;

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <MapIcon color="action" />
        <Typography variant="h6">{t("aggRegionMapTitle")}</Typography>
      </Stack>
      <Box
        sx={{
          height: 360,
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
              framing="magnitude"
              remountKey={`${grain}:${target ?? "bund"}`}
              styleVersion={fc.features.length}
            />
          )}
          <FitBounds points={points} />
        </MapContainer>
      </Box>
    </Stack>
  );
}

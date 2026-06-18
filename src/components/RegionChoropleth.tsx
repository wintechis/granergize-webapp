/**
 * Region **choropleth** — a Leaflet map whose cells are AGS-keyed regions shaded by
 * a regional measure. Buildings are point-grained (markers); aggregations and regional
 * statistics are area-grained, so the cell is a shaded region.
 *
 * **Zoom-driven level of detail**: the grain follows the map zoom — Bundesland when
 * zoomed out, Kreis at mid zoom, Gemeinde when zoomed in — so the user drives the
 * viewport and the regions just get finer; the map never recenters itself (no jumps).
 *
 * Value sources by grain:
 * - **Bundesland / Kreis** — `linked-nuts` polygons (whole) shaded by a chosen
 *   `linked-regionalstatistik` table (the metric dropdown), joined by `ags`.
 * - **Gemeinde** — `linked-lau` polygons for the current viewport `bbox`, shaded by
 *   real per-Gemeinde rooftop-PV build-out (Ausbaugrad) from `linked-energieatlas`.
 *   Energie-Atlas has no bulk endpoint, so we fetch ONE resource per visible Bavarian
 *   Gemeinde (cached per AGS) — Bavaria-only; non-Bavarian Gemeinden show no data.
 *
 * Each region is classified into a magnitude band over the visible value set (the same
 * tercile lens the map markers use) and coloured via the shared {@link bandColor}.
 *
 * Mounted standalone for now (a dedicated route) to validate end-to-end against the
 * live wrappers; its permanent home is deferred — see `plans/plan-region-choropleth.md`.
 */
import { useEffect, useRef, useState } from "react";
import {
  GeoJSON,
  MapContainer,
  useMapEvents,
  WMSTileLayer,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { LatLngBounds, Layer, PathOptions } from "leaflet";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Box, MenuItem, Select, Typography } from "@mui/material";
import {
  fetchRegionGeometry,
  type RegionFeatureProps,
  type RegionGrain,
  type RegionScope,
} from "../services/regionGeometry.ts";
import {
  fetchRegionalChoropleth,
  REGIONAL_TABLES,
  type RegionalObservation,
  type RegionalTable,
} from "../services/regionalCube.ts";
import {
  BAVARIA_AGS_PREFIX,
  fetchAreaPotential,
  type GemeindePotential,
} from "../services/energieatlas.ts";
import { magnitudeCategoriserFor } from "../services/energy/energyMetric.ts";
import { bandColor, bandLabelKey, legendBands } from "../constants/lensBand.ts";
import { BASEMAP_DE } from "../lib/orthophoto.ts";
import { msg } from "../lib/messages.ts";

/** Regional shares/intensities carry no good/bad — colour with the neutral ramp. */
const FRAMING = "magnitude" as const;
const DAY = 24 * 60 * 60 * 1000;

// Zoom thresholds for the level of detail (Leaflet zoom; Germany sits at ~6).
const ZOOM_KREIS = 7; // ≥ this → Kreis
const ZOOM_GEMEINDE = 10; // ≥ this → Gemeinde
// Safety cap on the per-Gemeinde Energie-Atlas fan-out (one GET each).
const MAX_GEMEINDE_FETCH = 500;

const EMPTY_VALUES = new Map<string, RegionalObservation>();

function grainForZoom(zoom: number): RegionGrain {
  if (zoom >= ZOOM_GEMEINDE) return "gemeinde";
  if (zoom >= ZOOM_KREIS) return "kreis";
  return "land";
}

/** The regionalstatistik value-grain a display grain reads from (Gemeinde has none). */
function valueGrainOf(grain: RegionGrain): "land" | "kreis" {
  return grain === "land" ? "land" : "kreis";
}

/** A coarse, cache-friendly bbox string (2-dp) so small pans reuse the same query. */
function bboxParam(bounds: LatLngBounds): string {
  const r = (n: number) => n.toFixed(2);
  return `${r(bounds.getWest())},${r(bounds.getSouth())},${r(bounds.getEast())},${r(bounds.getNorth())}`;
}

/** Region polygons — long staleTime (geometry changes ~yearly). Gemeinde needs a
 *  viewport scope; its query is disabled until the map reports one. */
function useRegionGeometry(grain: RegionGrain, scope?: RegionScope) {
  return useQuery({
    queryKey: ["regionGeometry", grain, scope?.bbox ?? scope?.parent ?? null],
    queryFn: () => fetchRegionGeometry(grain, scope),
    enabled: grain !== "gemeinde" || Boolean(scope?.bbox || scope?.parent),
    staleTime: DAY,
  });
}

/** The latest value per region for a regionalstatistik table (one GET, whole layer). */
function useRegionalChoropleth(table: RegionalTable, enabled: boolean) {
  return useQuery({
    queryKey: ["regionalChoropleth", table.tableId],
    queryFn: () => fetchRegionalChoropleth(table),
    enabled,
    staleTime: 60 * 60 * 1000,
  });
}

/** Reports the live map zoom + viewport bbox to the parent on every settle. */
function ViewWatch(
  { onChange }: { onChange: (zoom: number, bbox: string) => void },
) {
  const map = useMapEvents({
    zoomend: () => onChange(map.getZoom(), bboxParam(map.getBounds())),
    moveend: () => onChange(map.getZoom(), bboxParam(map.getBounds())),
  });
  useEffect(() => {
    onChange(map.getZoom(), bboxParam(map.getBounds()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function RegionChoropleth() {
  const [zoom, setZoom] = useState(6);
  const [bbox, setBbox] = useState<string | null>(null);
  // The user's chosen regionalstatistik metric per value-grain (Land / Kreis).
  const [selectedId, setSelectedId] = useState<Record<string, string>>({});

  const grain = grainForZoom(zoom);
  const isGemeinde = grain === "gemeinde";
  const scope: RegionScope | undefined = isGemeinde && bbox ? { bbox } : undefined;
  const geo = useRegionGeometry(grain, scope);
  const fc = geo.data;

  // --- Land / Kreis values: a chosen regionalstatistik table ------------------
  const valueGrain = valueGrainOf(grain);
  const metricChoices = REGIONAL_TABLES.filter((t) => t.grain === valueGrain);
  const valuesTable = metricChoices.find((t) => t.tableId === selectedId[valueGrain]) ??
    metricChoices[0];
  const regional = useRegionalChoropleth(valuesTable, !isGemeinde);
  const regionalMap = regional.data ?? EMPTY_VALUES;

  // --- Gemeinde values: real per-municipality Energie-Atlas (Bavaria) ---------
  const bavAgs = isGemeinde && fc
    ? fc.features
      .map((f) => f.properties.ags)
      .filter((a) => a.startsWith(BAVARIA_AGS_PREFIX))
      .slice(0, MAX_GEMEINDE_FETCH)
    : [];
  const eaResults = useQueries({
    queries: bavAgs.map((ags) => ({
      queryKey: ["energieatlas", ags],
      queryFn: () => fetchAreaPotential(ags),
      staleTime: DAY,
    })),
  });
  const eaByAgs = new Map<string, GemeindePotential>();
  bavAgs.forEach((ags, i) => {
    const d = eaResults[i]?.data;
    if (d) eaByAgs.set(ags, d);
  });

  // The numeric value a feature shades by, and the full set classified over.
  const valueOf = (props?: RegionFeatureProps): number | null => {
    if (!props?.ags) return null;
    if (isGemeinde) return eaByAgs.get(props.ags)?.developmentDegreePct ?? null;
    return regionalMap.get(props.ags)?.value ?? null;
  };
  const allValues = isGemeinde
    ? [...eaByAgs.values()].map((d) => d.developmentDegreePct).filter((v): v is number => v != null)
    : [...regionalMap.values()].map((o) => o.value);
  const classify = magnitudeCategoriserFor(allValues);

  const styleFeature = (
    feature?: Feature<Geometry, RegionFeatureProps>,
  ): PathOptions => {
    const v = valueOf(feature?.properties);
    const band = v != null ? classify(v) : "none";
    return {
      fillColor: bandColor(band, FRAMING),
      fillOpacity: 0.7,
      color: "#555",
      weight: 1,
    };
  };

  // Tooltip content is resolved lazily (on open) from the latest values, so the
  // Energie-Atlas figures appear as their per-Gemeinde GETs resolve.
  const tooltipRef = useRef<(p: RegionFeatureProps) => string>(() => "");
  tooltipRef.current = (p) => {
    const head = `<strong>${p.label || p.code || ""}</strong>`;
    if (isGemeinde) {
      const d = eaByAgs.get(p.ags);
      if (!d) return `${head}<br/>${msg("lensBandNoData")}`;
      const pct = d.developmentDegreePct;
      return `${head}<br/>${msg("choroplethGemeindeMetric")}: ${pct != null ? pct + " %" : "—"}` +
        `<br/>${d.installedCapacityMWp ?? "—"} / ${d.pvPotentialCapacityMWp ?? "—"} MWp`;
    }
    const o = regionalMap.get(p.ags);
    return o
      ? `${head}<br/>${o.value.toLocaleString("de-DE")} ${o.unit} (${o.year})`
      : `${head}<br/>${msg("lensBandNoData")}`;
  };

  const onEachFeature = (
    feature: Feature<Geometry, RegionFeatureProps>,
    layer: Layer,
  ) => {
    layer.bindTooltip(() => tooltipRef.current(feature.properties), { sticky: true });
  };

  // Geometry remounts only when the level/area changes (react-leaflet GeoJSON ignores
  // data-prop changes); value loads restyle the existing layer through the ref, so
  // colours appear without the viewport jumping.
  const layerKey = `${grain}|${isGemeinde ? bbox ?? "" : ""}`;
  const layerRef = useRef<L.GeoJSON | null>(null);
  const loadedCount = isGemeinde ? eaByAgs.size : regionalMap.size;
  useEffect(() => {
    layerRef.current?.setStyle(styleFeature as (f?: Feature) => PathOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grain, loadedCount]);

  const levelLabel = grain === "land"
    ? msg("choroplethLevelLand")
    : grain === "kreis"
    ? msg("choroplethLevelKreis")
    : msg("choroplethLevelGemeinde");

  return (
    <Box sx={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
      <Box sx={{ p: 2, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
        <Typography variant="h5">{msg("choroplethTitle")}</Typography>
        <Typography variant="body2">{levelLabel}</Typography>
        {isGemeinde
          ? (
            <Typography variant="body2" color="text.secondary">
              {msg("choroplethGemeindeMetric")} · {msg("choroplethGemeindeSource")}
            </Typography>
          )
          : (
            <Select
              size="small"
              value={valuesTable.tableId}
              onChange={(e) =>
                setSelectedId((s) => ({ ...s, [valueGrain]: e.target.value }))}
              sx={{ minWidth: 280 }}
            >
              {metricChoices.map((t) => (
                <MenuItem key={t.tableId} value={t.tableId}>
                  {msg(t.labelId)}
                </MenuItem>
              ))}
            </Select>
          )}
        <Typography variant="body2" color="text.secondary">
          {msg("choroplethZoomHint")}
        </Typography>
        {geo.isPending && (
          <Typography variant="body2" color="text.secondary">
            {msg("choroplethLoading")}
          </Typography>
        )}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
        <MapContainer center={[51.1, 10.4]} zoom={6} style={{ height: "100%" }}>
          <WMSTileLayer
            url={BASEMAP_DE.url}
            layers={BASEMAP_DE.layers}
            format="image/png"
            attribution={BASEMAP_DE.attribution}
          />
          <ViewWatch
            onChange={(z, b) => {
              setZoom(z);
              setBbox(b);
            }}
          />
          {fc && (
            <GeoJSON
              key={layerKey}
              ref={layerRef}
              data={fc as unknown as FeatureCollection}
              style={styleFeature as (f?: Feature) => PathOptions}
              onEachFeature={onEachFeature as (f: Feature, l: Layer) => void}
            />
          )}
        </MapContainer>
        <Legend />
      </Box>
    </Box>
  );
}

/** The shared magnitude legend (low → high → no-data), reusing the lens band colours. */
function Legend() {
  return (
    <Box
      sx={{
        position: "absolute",
        bottom: 16,
        right: 16,
        zIndex: 1000,
        bgcolor: "background.paper",
        p: 1,
        borderRadius: 1,
        boxShadow: 2,
      }}
    >
      {legendBands(FRAMING).map((band) => (
        <Box key={band} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box
            sx={{
              width: 14,
              height: 14,
              bgcolor: bandColor(band, FRAMING),
              border: "1px solid",
              borderColor: "divider",
            }}
          />
          <Typography variant="caption">
            {msg(bandLabelKey(band, FRAMING))}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

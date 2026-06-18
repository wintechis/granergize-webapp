/**
 * The building's LOCATION ENERGY PROFILE as a small choropleth: the neighbouring
 * **Gemeinden** around the building (from `linked-lau`, fetched for a bbox around its
 * coordinates) shaded by each municipality's real rooftop-PV build-out (Ausbaugrad)
 * from `linked-energieatlas`. A queried, off-Pod observation about the building's
 * *place* — the area-grained sibling of the point-grained nearby-installations and
 * the Bundesland/Kreis figures in {@link ./RegionalContextSection.tsx}.
 *
 * Energie-Atlas covers Bavaria only and has no bulk endpoint, so this fetches ONE
 * `area/{ags}` resource per visible Bavarian Gemeinde (cached per AGS). Renders
 * nothing for a building outside Bavaria or without coordinates (degrades silently,
 * like the weather/regional sections).
 */
import { useEffect, useRef } from "react";
import {
  GeoJSON,
  MapContainer,
  Marker,
  WMSTileLayer,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type L from "leaflet";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { Layer, PathOptions } from "leaflet";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Box, Stack, Typography } from "@mui/material";
import SolarPowerIcon from "@mui/icons-material/SolarPower";
import type { BuildingType } from "../../types.ts";
import {
  fetchRegionGeometry,
  type RegionFeatureProps,
} from "../../services/regionGeometry.ts";
import {
  type AreaProfile,
  fetchAreaProfile,
} from "../../services/standortEnergieprofil.ts";
import { magnitudeCategoriserFor } from "../../services/energy/energyMetric.ts";
import { bandColor, bandLabelKey, legendBands } from "../../constants/lensBand.ts";
import { BASEMAP_DE } from "../../lib/orthophoto.ts";
import { buildingPin } from "../../lib/buildingPin.ts";
import { useT } from "../../context/I18nProvider.tsx";

const FRAMING = "magnitude" as const;
const DAY = 24 * 60 * 60 * 1000;
const HALF = 0.12; // bbox half-extent (deg) around the building — ≈ 13 km of neighbours

function bboxAround(lat: number, long: number): string {
  const r = (n: number) => n.toFixed(2);
  return `${r(long - HALF)},${r(lat - HALF)},${r(long + HALF)},${r(lat + HALF)}`;
}

export default function NeighbourhoodEnergyMap(
  { building }: { building: BuildingType },
) {
  const t = useT();
  const { lat, long } = building;
  const bbox = lat != null && long != null ? bboxAround(lat, long) : null;

  // Neighbour Gemeinden in the viewport bbox (linked-lau).
  const geo = useQuery({
    queryKey: ["regionGeometry", "gemeinde", bbox],
    queryFn: () => fetchRegionGeometry("gemeinde", { bbox: bbox! }),
    enabled: Boolean(bbox),
    staleTime: DAY,
  });
  const fc = geo.data;

  // One Energie-Atlas profile per Bavarian Gemeinde (8-digit AGS, leading 09),
  // cached per AGS — sharing the `["standortEnergieprofil", ags]` query with the
  // building's own Standort-Energieprofil panel.
  const bavAgs = fc
    ? fc.features.map((f) => f.properties.ags).filter((a) => a.startsWith("09"))
    : [];
  const eaResults = useQueries({
    queries: bavAgs.map((ags) => ({
      queryKey: ["standortEnergieprofil", ags],
      queryFn: () => fetchAreaProfile(ags),
      staleTime: DAY,
    })),
  });
  const eaByAgs = new Map<string, AreaProfile>();
  bavAgs.forEach((ags, i) => {
    const d = eaResults[i]?.data;
    if (d) eaByAgs.set(ags, d);
  });
  const loaded = eaByAgs.size;

  // Shade by the rooftop-PV build-out (Ausbaugrad), classified over the visible set.
  const values = [...eaByAgs.values()]
    .map((d) => d.rooftop?.degreePct)
    .filter((v): v is number => v != null);
  const classify = magnitudeCategoriserFor(values);

  const styleFeature = (
    feature?: Feature<Geometry, RegionFeatureProps>,
  ): PathOptions => {
    const pct = feature?.properties?.ags
      ? eaByAgs.get(feature.properties.ags)?.rooftop?.degreePct
      : undefined;
    const band = pct != null ? classify(pct) : "none";
    return { fillColor: bandColor(band, FRAMING), fillOpacity: 0.65, color: "#555", weight: 1 };
  };

  // Tooltip resolved lazily (on open) from the latest values, so each Gemeinde's
  // figure appears as its GET resolves.
  const tipRef = useRef<(p: RegionFeatureProps) => string>(() => "");
  useEffect(() => {
    tipRef.current = (p) => {
      const d = eaByAgs.get(p.ags);
      const name = (d?.name || p.label || p.code || "").toString();
      const roof = d?.rooftop;
      if (!roof) return `<strong>${name}</strong>`;
      return `<strong>${name}</strong><br/>${t("choroplethGemeindeMetric")}: ${roof.degreePct ?? "—"} %` +
        `<br/>${roof.installedMWp ?? "—"} / ${roof.potentialMWp ?? "—"} MWp`;
    };
  });
  const onEachFeature = (
    feature: Feature<Geometry, RegionFeatureProps>,
    layer: Layer,
  ) => {
    layer.bindTooltip(() => tipRef.current(feature.properties), { sticky: true });
  };

  const layerRef = useRef<L.GeoJSON | null>(null);
  useEffect(() => {
    layerRef.current?.setStyle(styleFeature as (f?: Feature) => PathOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Best-effort: render only once we actually have neighbour figures to shade.
  // No coordinates, off Bavaria, a fetch error, or still loading → render nothing
  // (like the weather / regional-context sections) — and never a stray empty map.
  if (lat == null || long == null || loaded === 0) return null;

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <SolarPowerIcon color="action" />
        <Typography variant="h6">{t("neighbourhoodTitle")}</Typography>
      </Stack>
      <Box sx={{ position: "relative", height: 320, borderRadius: 1, overflow: "hidden" }}>
        <MapContainer
          center={[lat, long]}
          zoom={10}
          scrollWheelZoom={false}
          style={{ height: "100%" }}
        >
          <WMSTileLayer
            url={BASEMAP_DE.url}
            layers={BASEMAP_DE.layers}
            format="image/png"
            attribution={BASEMAP_DE.attribution}
          />
          {fc && (
            <GeoJSON
              key={`${bbox}|${loaded}`}
              ref={layerRef}
              data={fc as unknown as FeatureCollection}
              style={styleFeature as (f?: Feature) => PathOptions}
              onEachFeature={onEachFeature as (f: Feature, l: Layer) => void}
            />
          )}
          {/* The building's own location — the same owned/shared pin the detail-page
              header uses, in the marker pane (above the polygons). */}
          <Marker
            position={[lat, long]}
            icon={buildingPin(building.isShared ?? false)}
            interactive={false}
          />
        </MapContainer>
        <Box
          sx={{
            position: "absolute",
            bottom: 8,
            right: 8,
            zIndex: 1000,
            bgcolor: "background.paper",
            p: 0.5,
            borderRadius: 1,
            boxShadow: 2,
          }}
        >
          {legendBands(FRAMING).map((band) => (
            <Box key={band} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  bgcolor: bandColor(band, FRAMING),
                  border: "1px solid",
                  borderColor: "divider",
                }}
              />
              <Typography variant="caption">{t(bandLabelKey(band, FRAMING))}</Typography>
            </Box>
          ))}
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t("neighbourhoodSource")}
      </Typography>
    </Stack>
  );
}

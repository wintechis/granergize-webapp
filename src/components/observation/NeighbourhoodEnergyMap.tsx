/**
 * The building's LOCATION ENERGY PROFILE as an **interactive** neighbourhood
 * choropleth: the Gemeinden around the building (from `linked-lau`, scoped to the
 * map's current viewport) shaded by each municipality's real rooftop-PV build-out
 * (Ausbaugrad) from `linked-energieatlas`. Pan/zoom reloads the visible Gemeinden.
 * The area-grained sibling of the point-grained nearby-installations and the
 * Bundesland/Kreis figures in {@link ./RegionalContextSection.tsx}.
 *
 * Energie-Atlas covers Bavaria only and has no bulk endpoint, so one `area/{ags}` is
 * fetched per visible Bavarian Gemeinde (cached per AGS, capped). Shown only for a
 * building in Bavaria — elsewhere there's no data, so the section is omitted.
 */
import { useState } from "react";
import { MapContainer, Marker, WMSTileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
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
import { BASEMAP_DE } from "../../lib/orthophoto.ts";
import { buildingPin } from "../../lib/buildingPin.ts";
import MagnitudeChoroplethLayer from "../region/MagnitudeChoroplethLayer.tsx";
import MagnitudeLegend from "../region/MagnitudeLegend.tsx";
import ViewWatch from "../region/ViewWatch.tsx";
import { useT } from "../../context/I18nProvider.tsx";

const FRAMING = "magnitude" as const;
const DAY = 24 * 60 * 60 * 1000;
// Cap the per-Gemeinde Energie-Atlas fan-out (one GET each) as the viewport widens.
const MAX_GEMEINDE_FETCH = 400;
// Bavaria's bounding box — Energie-Atlas coverage. A building outside it has no data,
// so the section is omitted (a stable check, so the map stays mounted for panning).
const BAVARIA = { w: 8.9, s: 47.2, e: 13.9, n: 50.6 };

function bboxAround(lat: number, long: number): string {
  const r = (n: number) => n.toFixed(2);
  return `${r(long - 0.12)},${r(lat - 0.12)},${r(long + 0.12)},${r(lat + 0.12)}`;
}

export default function NeighbourhoodEnergyMap(
  { building }: { building: BuildingType },
) {
  const t = useT();
  const { lat, long } = building;
  const inBavaria = lat != null && long != null &&
    long >= BAVARIA.w && long <= BAVARIA.e && lat >= BAVARIA.s && lat <= BAVARIA.n;

  // The viewport bbox follows pan/zoom (ViewWatch); seeded from the building so the
  // first fetch fires before the map reports its bounds.
  const [bbox, setBbox] = useState<string | null>(
    inBavaria ? bboxAround(lat!, long!) : null,
  );

  const geo = useQuery({
    queryKey: ["regionGeometry", "gemeinde", bbox],
    queryFn: () => fetchRegionGeometry("gemeinde", { bbox: bbox! }),
    enabled: Boolean(bbox),
    staleTime: DAY,
  });
  const fc = geo.data;

  // One Energie-Atlas profile per visible Bavarian Gemeinde (shared cache key with
  // the building's own Standort-Energieprofil panel).
  const bavAgs = fc
    ? fc.features.map((f) => f.properties.ags)
      .filter((a) => a.startsWith("09")).slice(0, MAX_GEMEINDE_FETCH)
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

  // Shade by rooftop-PV build-out (Ausbaugrad), classified over the visible set.
  const classify = magnitudeCategoriserFor(
    [...eaByAgs.values()].map((d) => d.rooftop?.degreePct)
      .filter((v): v is number => v != null),
  );
  const bandOf = (p: RegionFeatureProps) => {
    const pct = eaByAgs.get(p.ags)?.rooftop?.degreePct;
    return pct != null ? classify(pct) : "none";
  };
  const tooltip = (p: RegionFeatureProps) => {
    const profile = eaByAgs.get(p.ags);
    const name = (profile?.name || p.label || p.code || "").toString();
    const roof = profile?.rooftop;
    if (!roof) return `<strong>${name}</strong>`;
    return `<strong>${name}</strong><br/>${t("choroplethGemeindeMetric")}: ${roof.degreePct ?? "—"} %` +
      `<br/>${roof.installedMWp ?? "—"} / ${roof.potentialMWp ?? "—"} MWp`;
  };

  if (!inBavaria) return null;

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <SolarPowerIcon color="action" />
        <Typography variant="h6">{t("neighbourhoodTitle")}</Typography>
      </Stack>
      <Box sx={{ position: "relative", height: 320, borderRadius: 1, overflow: "hidden" }}>
        <MapContainer center={[lat!, long!]} zoom={10} style={{ height: "100%" }}>
          <WMSTileLayer
            url={BASEMAP_DE.url}
            layers={BASEMAP_DE.layers}
            format="image/png"
            attribution={BASEMAP_DE.attribution}
          />
          <ViewWatch onChange={(_zoom, b) => setBbox(b)} />
          {fc && (
            <MagnitudeChoroplethLayer
              data={fc}
              bandOf={bandOf}
              tooltip={tooltip}
              framing={FRAMING}
              remountKey={bbox ?? ""}
              styleVersion={loaded}
            />
          )}
          {/* The building's own location — the shared owned/shared pin, marker pane. */}
          <Marker
            position={[lat!, long!]}
            icon={buildingPin(building.isShared ?? false)}
            interactive={false}
          />
        </MapContainer>
        {loaded > 0 && <MagnitudeLegend framing={FRAMING} />}
      </Box>
      <Typography variant="caption" color="text.secondary">
        {t("neighbourhoodSource")}
      </Typography>
    </Stack>
  );
}

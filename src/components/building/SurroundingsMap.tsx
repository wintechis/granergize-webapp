import { useEffect, useMemo } from "react";
import { Box, Typography } from "@mui/material";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Popup,
  Tooltip,
  useMap,
  WMSTileLayer,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { detailBaseLayer } from "../../lib/orthophoto.ts";
import { buildingPin } from "../../lib/buildingPin.ts";
import type { Building } from "../../types.ts";
import type {
  InstallationKind,
  NearbyInstallation,
} from "../../services/sources/mastrNearby.ts";
import type { NearbyRooftopGeometry } from "../../services/sources/lod2Rooftop.ts";
import {
  magnitudeCategoriserFor,
  type MetricFraming,
} from "../../services/energy/energyMetric.ts";
import { bandColor } from "../../constants/lensBand.ts";
import { RdfSourceLink } from "../detail/DetailView.tsx";
import { useT } from "../../context/I18nProvider.tsx";
import type { MessageId } from "../../lib/messages.ts";

const FRAMING: MetricFraming = "magnitude";

const KIND_LABEL: Record<InstallationKind, MessageId> = {
  solar: "niKindSolar",
  wind: "niKindWind",
  hydro: "niKindHydro",
  biomass: "niKindBiomass",
};

/** Per-kind marker fill, taken from the theme palette family the kind reads as. */
const KIND_COLOR: Record<InstallationKind, string> = {
  solar: "#f9a825", // amber — sun
  wind: "#0288d1", // blue — air
  hydro: "#00838f", // teal — water
  biomass: "#558b2f", // green — bio
};

/** Pan/zoom to frame the building + every surrounding feature whenever the set
 *  of points changes. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], detailBaseLayer(points[0][0], points[0][1]).zoom);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 17 });
  }, [map, points]);
  return null;
}

/**
 * The ONE surroundings map ({@link SurroundingsSection}'s map guise): the building
 * (owned/shared {@link buildingPin}) with BOTH neighbourhood layers overlaid —
 * the nearby rooftops' footprints as kWp-shaded polygons (dot fallback while a
 * footprint deref is in flight or absent) underneath, and the MaStR generation
 * units as kind-coloured dots on top. Every feature carries a hover tooltip and
 * a click popup with its dereferenceable source IRI. Merges the former
 * NearbyInstallationsMap + NearbyRooftopsMap, so the neighbourhood is one map,
 * not two of the same place.
 */
export default function SurroundingsMap(
  { building, installations, rooftops, height = 420 }: {
    building: Building;
    installations: NearbyInstallation[];
    rooftops: NearbyRooftopGeometry[];
    height?: number;
  },
) {
  const t = useT();
  const lat = building.lat!;
  const long = building.long!;
  const base = detailBaseLayer(lat, long);

  const classify = useMemo(
    () => magnitudeCategoriserFor(rooftops.map((r) => r.installableKwp)),
    [rooftops],
  );
  const maxKwp = useMemo(
    () => Math.max(1, ...rooftops.map((r) => r.installableKwp)),
    [rooftops],
  );

  // Frame the building + every unit + every rooftop (polygon vertices when
  // present, else the centre).
  const points: [number, number][] = useMemo(() => {
    const pts: [number, number][] = [[lat, long]];
    for (const u of installations) pts.push([u.lat, u.long]);
    for (const r of rooftops) {
      const rings = r.roofs.filter((s) => s.polygon);
      if (rings.length === 0) pts.push([r.lat, r.long]);
      else {
        for (const s of rings) {
          for (const [lon, la] of s.polygon!) pts.push([la, lon]);
        }
      }
    }
    return pts;
  }, [lat, long, installations, rooftops]);

  const rooftopTip = (r: NearbyRooftopGeometry) =>
    `${t("nrKwp", { kwp: r.installableKwp.toFixed(1) })} — ${
      t("niDistance", { km: r.distanceKm.toFixed(1) })
    }`;

  // Click → the feature's description with its ORIGINAL source (the linked-lod2-by /
  // linked-mastr resource) as a clickable, dereferenceable link.
  const rooftopPopup = (r: NearbyRooftopGeometry) => (
    <Popup>
      <Typography variant="body2">{rooftopTip(r)}</Typography>
      <RdfSourceLink href={r.iri} inline />
    </Popup>
  );

  return (
    <Box
      sx={{
        width: "100%",
        height,
        borderRadius: 1,
        overflow: "hidden",
        border: 1,
        borderColor: "divider",
      }}
    >
      <MapContainer
        center={[lat, long]}
        zoom={base.zoom}
        zoomControl
        dragging
        doubleClickZoom
        scrollWheelZoom={false}
        attributionControl={false}
        style={{ height: "100%", width: "100%" }}
      >
        <WMSTileLayer
          url={base.config.url}
          layers={base.config.layers}
          format={base.config.format}
          maxZoom={base.config.maxZoom}
          transparent={false}
          attribution={base.config.attribution}
        />
        <Marker position={[lat, long]} icon={buildingPin(building.isShared ?? false)} />
        {/* Rooftop layer first — area fills sit UNDER the installation dots. */}
        {rooftops.map((r) => {
          const fill = bandColor(classify(r.installableKwp), FRAMING);
          const rings = r.roofs.filter((s) => s.polygon);
          // No footprint (not loaded yet, or none served) → a kWp-sized dot fallback.
          if (rings.length === 0) {
            return (
              <CircleMarker
                key={r.iri}
                center={[r.lat, r.long]}
                radius={4 + 6 * (r.installableKwp / maxKwp)}
                pathOptions={{
                  color: "#fff",
                  weight: 1,
                  fillColor: fill,
                  fillOpacity: 0.9,
                }}
              >
                <Tooltip direction="top" offset={[0, -4]}>{rooftopTip(r)}</Tooltip>
                {rooftopPopup(r)}
              </CircleMarker>
            );
          }
          return rings.map((s, i) => (
            <Polygon
              key={`${r.iri}#${i}`}
              positions={s.polygon!.map(([lon, la]): [number, number] => [la, lon])}
              pathOptions={{
                color: "#555",
                weight: 0.7,
                fillColor: fill,
                fillOpacity: 0.85,
              }}
            >
              <Tooltip direction="top" offset={[0, -4]}>{rooftopTip(r)}</Tooltip>
              {rooftopPopup(r)}
            </Polygon>
          ));
        })}
        {installations.map((u) => (
          <CircleMarker
            key={u.iri}
            center={[u.lat, u.long]}
            radius={6}
            pathOptions={{
              color: "#fff",
              weight: 1,
              fillColor: KIND_COLOR[u.kind],
              fillOpacity: 0.9,
            }}
          >
            <Tooltip direction="top" offset={[0, -4]}>
              {t(KIND_LABEL[u.kind])} — {u.label || t("niUnnamed")} —{" "}
              {t("niDistance", { km: (u.distanceKm ?? 0).toFixed(1) })}
            </Tooltip>
            <Popup>
              <Typography variant="body2">
                {t(KIND_LABEL[u.kind])} — {u.label || t("niUnnamed")} —{" "}
                {t("niDistance", { km: (u.distanceKm ?? 0).toFixed(1) })}
              </Typography>
              <RdfSourceLink href={u.iri} inline />
            </Popup>
          </CircleMarker>
        ))}
        <FitBounds points={points} />
      </MapContainer>
    </Box>
  );
}

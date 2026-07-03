import { useEffect, useMemo } from "react";
import { Box, Typography } from "@mui/material";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  Tooltip,
  useMap,
  WMSTileLayer,
} from "react-leaflet";
import { RdfSourceLink } from "../detail/DetailView.tsx";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { detailBaseLayer } from "../../lib/orthophoto.ts";
import { buildingPin } from "../../lib/buildingPin.ts";
import type { Building } from "../../types.ts";
import type {
  InstallationKind,
  NearbyInstallation,
} from "../../services/sources/mastrNearby.ts";
import { useT } from "../../context/I18nProvider.tsx";
import type { MessageId } from "../../lib/messages.ts";

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

/** Pan/zoom the map to frame the building + all installations whenever the set
 *  of points changes. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], detailBaseLayer(points[0][0], points[0][1]).zoom);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 16 });
  }, [map, points]);
  return null;
}

/**
 * The MAP guise of {@link NearbyInstallationsSection}: the building (owned/shared
 * {@link buildingPin}) plus each nearby renewable installation as a kind-coloured
 * {@link CircleMarker} with a hover tooltip (kind — label — distance). The view
 * frames the building and every unit (fit-bounds). Mirrors the single-point
 * {@link ../LocatorMap} but for the multi-point installations set.
 */
export default function NearbyInstallationsMap(
  { building, installations, height = 320 }: {
    building: Building;
    installations: NearbyInstallation[];
    height?: number;
  },
) {
  const t = useT();
  const lat = building.lat!;
  const long = building.long!;
  const base = detailBaseLayer(lat, long);
  const points: [number, number][] = useMemo(
    () => [
      [lat, long],
      ...installations.map((u) => [u.lat, u.long] as [number, number]),
    ],
    [lat, long, installations],
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
            {/* Click → the same description with the unit's ORIGINAL source (its
                linked-mastr resource) as a clickable, dereferenceable link. */}
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

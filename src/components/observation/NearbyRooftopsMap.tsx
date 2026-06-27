import { useEffect, useMemo } from "react";
import { Box } from "@mui/material";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Tooltip,
  useMap,
  WMSTileLayer,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { detailBaseLayer } from "../../lib/orthophoto.ts";
import { buildingPin } from "../../lib/buildingPin.ts";
import type { Building } from "../../types.ts";
import type { NearbyRooftopGeometry } from "../../services/sources/lod2Rooftop.ts";
import {
  magnitudeCategoriserFor,
  type MetricFraming,
} from "../../services/energy/energyMetric.ts";
import { bandColor } from "../../constants/lensBand.ts";
import { useT } from "../../context/I18nProvider.tsx";

const FRAMING: MetricFraming = "magnitude";

/** Pan/zoom to frame the building + all rooftops whenever the set of points changes. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], detailBaseLayer(points[0][0], points[0][1]).zoom);
      return;
    }
    map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 18 });
  }, [map, points]);
  return null;
}

/**
 * The MAP guise of {@link NearbyRooftopsSection}: the building (owned/shared
 * {@link buildingPin}) plus each nearby building's roof FOOTPRINTS as polygons, shaded by
 * the building's installable kWp via the shared magnitude lens (the same shading as
 * {@link ../building/RoofPlan}). A building whose geometry isn't (yet) loaded or wasn't served
 * falls back to a kWp-sized dot, so the map is useful while the derefs are still in flight.
 */
export default function NearbyRooftopsMap(
  { building, rooftops, height = 420 }: {
    building: Building;
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

  // Frame the building + every rooftop (polygon vertices when present, else the centre).
  const points: [number, number][] = useMemo(() => {
    const pts: [number, number][] = [[lat, long]];
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
  }, [lat, long, rooftops]);

  const tip = (r: NearbyRooftopGeometry) =>
    `${t("nrKwp", { kwp: r.installableKwp.toFixed(1) })} — ${
      t("niDistance", { km: r.distanceKm.toFixed(1) })
    }`;

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
                <Tooltip direction="top" offset={[0, -4]}>{tip(r)}</Tooltip>
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
              <Tooltip direction="top" offset={[0, -4]}>{tip(r)}</Tooltip>
            </Polygon>
          ));
        })}
        <FitBounds points={points} />
      </MapContainer>
    </Box>
  );
}

import { Box } from "@mui/material";
import { MapContainer, Marker, WMSTileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { detailBaseLayer } from "../lib/orthophoto.ts";
import { buildingPin } from "../lib/buildingPin.ts";

/**
 * An interactive single-point **locator map** widget: the Bavaria DOP20c
 * orthophoto zoomed in where there's coverage, else the nationwide basemap raster
 * (see `lib/orthophoto.ts`), with the owned/shared {@link buildingPin} at
 * (lat, long). Pan + zoom buttons + double-click; wheel-zoom is OFF so it can't
 * hijack the surrounding (scrollable) page. Extracted from the bespoke inline map
 * `BuildingHeader` used to carry, so a single-location map is now a reusable widget.
 */
export default function LocatorMap(
  { lat, long, shared = false, height = 240 }: {
    lat: number;
    long: number;
    shared?: boolean;
    /** Pixel height; width is responsive (full-width on xs, 360 from sm). */
    height?: number;
  },
) {
  const base = detailBaseLayer(lat, long);
  return (
    <Box
      sx={{
        width: { xs: "100%", sm: 360 },
        height,
        flexShrink: 0,
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
        <Marker position={[lat, long]} icon={buildingPin(shared)} />
      </MapContainer>
    </Box>
  );
}

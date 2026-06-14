import { Box, Chip, Stack, Typography } from "@mui/material";
import { MapContainer, Marker, WMSTileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import CorporateFareIcon from "@mui/icons-material/CorporateFare";
import DownloadIcon from "@mui/icons-material/Download";
import type { BuildingType } from "../../types.ts";
import {
  buildingAddressLine,
  buildingDisplayName,
} from "../../lib/buildingDisplay.ts";
import { AgentLabel } from "../AgentLabel.tsx";
import { RefLink } from "../detail/DetailView.tsx";
import RowAction from "../RowAction.tsx";
import { MARKER_OWNED_COLOR, MARKER_SHARED_COLOR } from "../../constants/chartColors.ts";
import { getSession } from "../../hooks/session.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { attachAnnualData } from "../../services/rdf/building/buildingSerializer.ts";
import { buildingToXlsx } from "../../services/rdf/buildingWorkbook.ts";
import { buildingIdStem } from "../../services/rdf/building/buildingId.ts";
import { downloadXlsx } from "../../lib/download.ts";
import { formatError } from "../../lib/formatError.ts";

// The same German basemap WMS the main map uses (see ExplorePage.tsx); reused so
// the building page thumbnail matches the map the user just came from.
const BASEMAP_DE = {
  url: "https://sgx.geodatenzentrum.de/wms_basemapde",
  layers: "de_basemapde_web_raster_farbe",
  attribution:
    '&copy; <a href="https://basemap.de/">basemap.de</a> / &copy; <a href="https://www.bkg.bund.de/">BKG</a>',
} as const;

/**
 * A plain owned/shared pin for the thumbnail, matching the main map's ownership
 * lens (brand-blue owned / orange shared). A single cached DivIcon per ownership
 * so the thumbnail's marker isn't rebuilt on re-render.
 */
const pinCache = new Map<string, L.DivIcon>();
function thumbPin(shared: boolean): L.DivIcon {
  const key = shared ? "s" : "o";
  const hit = pinCache.get(key);
  if (hit) return hit;
  const color = shared ? MARKER_SHARED_COLOR : MARKER_OWNED_COLOR;
  const icon = L.divIcon({
    className: `pin-marker pin-${shared ? "shared" : "owned"}`,
    html:
      `<svg width="25" height="41" viewBox="0 0 25 41" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));" aria-hidden="true">` +
      `<path d="M12.5 0.5C5.9 0.5 0.5 5.9 0.5 12.5c0 9 12 27.5 12 27.5s12-18.5 12-27.5C24.5 5.9 19.1 0.5 12.5 0.5z" fill="${color}" stroke="#fff" stroke-width="1"/>` +
      `<circle cx="12.5" cy="12.5" r="4.5" fill="#fff"/></svg>`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
  });
  pinCache.set(key, icon);
  return icon;
}

/**
 * The building page's header: a breadcrumb back to the buildings list, the
 * building name + address, the producing-organisation attribution (the same
 * `attributedTo` AgentLabel the read view / map hover card surface), an
 * owned/shared badge, and a small locator map thumbnail (the main map's basemap
 * + an ownership-coloured pin).
 */
export default function BuildingHeader({ building }: { building: BuildingType }) {
  const name = buildingDisplayName(building);
  const address = buildingAddressLine(building);
  const shared = building.isShared ?? false;
  const hasCoords = building.lat != null && building.long != null;
  const { showNotification } = useNotification();

  // Export this building as an `.xlsx` workbook (moved here from the buildings
  // list, where the row no longer carries per-object actions). Energy is not
  // inline, so the annual datasets are attached before serialising; the stem is
  // the filename-safe form of the id (an IRI reference browsers mangle in names).
  const handleDownload = async () => {
    try {
      const [enriched] = await attachAnnualData([building], getSession());
      downloadXlsx(
        await buildingToXlsx(enriched),
        `building-${buildingIdStem(building.id)}.xlsx`,
      );
    } catch (error) {
      showNotification(formatError("export the building", error), "error");
    }
  };

  return (
    <Box>
      {/* Breadcrumb back to the buildings list (the Home tab). */}
      <Box sx={{ mb: 1 }}>
        <RefLink to="/">← Buildings</RefLink>
      </Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{ alignItems: "flex-start", justifyContent: "space-between" }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
            <CorporateFareIcon color="action" />
            <Typography variant="h5">{name}</Typography>
            <Chip
              size="small"
              label={shared ? "Shared with you" : "Owned"}
              color={shared ? "warning" : "primary"}
              variant="outlined"
            />
            <RowAction
              label="Download building data (Excel)"
              icon={<DownloadIcon fontSize="small" />}
              onClick={handleDownload}
            />
          </Stack>
          {address && (
            <Typography variant="body1" color="text.secondary">
              {address}
            </Typography>
          )}
          {building.attributedTo && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5 }}
            >
              Data source: <AgentLabel value={building.attributedTo} />
            </Typography>
          )}
        </Box>

        {/* Locator thumbnail — a non-interactive mini-map of the building's
            location. Hidden when the building has no coordinates. */}
        {hasCoords && (
          <Box
            sx={{
              width: { xs: "100%", sm: 220 },
              height: 140,
              flexShrink: 0,
              borderRadius: 1,
              overflow: "hidden",
              border: 1,
              borderColor: "divider",
            }}
          >
            <MapContainer
              center={[building.lat as number, building.long as number]}
              zoom={14}
              zoomControl={false}
              dragging={false}
              scrollWheelZoom={false}
              doubleClickZoom={false}
              attributionControl={false}
              style={{ height: "100%", width: "100%" }}
            >
              <WMSTileLayer
                url={BASEMAP_DE.url}
                layers={BASEMAP_DE.layers}
                format="image/png"
                transparent={false}
                attribution={BASEMAP_DE.attribution}
              />
              <Marker
                position={[building.lat as number, building.long as number]}
                icon={thumbPin(shared)}
              />
            </MapContainer>
          </Box>
        )}
      </Stack>
    </Box>
  );
}

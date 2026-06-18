import { msg } from "../../lib/messages.ts";
import { Box, Chip, Stack, Typography } from "@mui/material";
import { MapContainer, Marker, WMSTileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import CorporateFareIcon from "@mui/icons-material/CorporateFare";
import DownloadIcon from "@mui/icons-material/Download";
import type { BuildingType } from "../../types.ts";
import {
  buildingAddressLine,
  buildingDisplayName,
} from "../../lib/buildingDisplay.ts";
import { AgentLabel } from "../AgentLabel.tsx";
import { RefLink } from "../detail/DetailView.tsx";
import IconAction from "../IconAction.tsx";
import { buildingPin } from "./buildingPin.ts";
import { getGateway } from "../../hooks/session.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { attachAnnualData } from "../../services/rdf/building/buildingSerializer.ts";
import { buildingToXlsx } from "../../services/xlsx/buildingWorkbook.ts";
import { buildingIdStem } from "../../services/rdf/building/buildingId.ts";
import { downloadXlsx } from "../../lib/download.ts";
import { formatError } from "../../lib/formatError.ts";
import { detailBaseLayer } from "../../lib/orthophoto.ts";

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
  // Pick the locator-thumbnail base layer from the coordinates (orthophoto where
  // covered, basemap raster otherwise); only read inside the `hasCoords` guard.
  const base = detailBaseLayer(building.lat ?? 0, building.long ?? 0);
  const { showNotification } = useNotification();

  // Export this building as an `.xlsx` workbook (moved here from the buildings
  // list, where the row no longer carries per-object actions). Energy is not
  // inline, so the annual datasets are attached before serialising; the stem is
  // the filename-safe form of the id (an IRI reference browsers mangle in names).
  const handleDownload = async () => {
    try {
      const [enriched] = await attachAnnualData([building], getGateway());
      downloadXlsx(
        await buildingToXlsx(enriched),
        `building-${buildingIdStem(building.id)}.xlsx`,
      );
    } catch (error) {
      showNotification(formatError("actionExportBuilding", error), "error");
    }
  };

  return (
    <Box>
      {/* Breadcrumb back to the buildings list (the Home tab). */}
      <Box sx={{ mb: 1 }}>
        <RefLink to="/">{msg("bhBackBuildings")}</RefLink>
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
              label={shared ? msg("chipSharedWithYou") : msg("chipOwned")}
              color={shared ? "warning" : "primary"}
              variant="outlined"
            />
            <IconAction
              label={msg("bhDownloadData")}
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
              {msg("dataSourceLabel")} <AgentLabel value={building.attributedTo} />
            </Typography>
          )}
        </Box>

        {/* Locator thumbnail — a non-interactive mini-map of the building's
            location: the Bavaria DOP20c orthophoto zoomed in where there's
            coverage (the pilot is in Nürnberg), else the nationwide basemap
            raster (see lib/orthophoto.ts). Hidden when there are no coordinates. */}
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
              zoom={base.zoom}
              zoomControl={false}
              dragging={false}
              scrollWheelZoom={false}
              doubleClickZoom={false}
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
              <Marker
                position={[building.lat as number, building.long as number]}
                icon={buildingPin(shared)}
              />
            </MapContainer>
          </Box>
        )}
      </Stack>
    </Box>
  );
}

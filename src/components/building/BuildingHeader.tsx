import { msg } from "../../lib/messages.ts";
import { Box, Stack, Typography } from "@mui/material";
import TierBadge from "../TierBadge.tsx";
import CorporateFareIcon from "@mui/icons-material/CorporateFare";
import DownloadIcon from "@mui/icons-material/Download";
import type { Building } from "../../types.ts";
import {
  buildingAddressLine,
  buildingDisplayName,
} from "../../lib/buildingDisplay.ts";
import { AgentLabel } from "../AgentLabel.tsx";
import { BackLink, RdfSourceLink } from "../detail/DetailView.tsx";
import { FINDERS } from "../../routes.ts";
import SourceNote from "../SourceNote.tsx";
import { SOURCES } from "../../constants/dataSources.ts";
import IconAction from "../IconAction.tsx";
import LocatorMap from "../LocatorMap.tsx";
import { getGateway } from "../../hooks/session.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { attachAnnualData } from "../../services/rdf/building/buildingSerializer.ts";
import { buildingToXlsx } from "../../services/xlsx/buildingWorkbook.ts";
import {
  buildingFileUri,
  buildingIdStem,
} from "../../services/rdf/building/buildingId.ts";
import { downloadXlsx } from "../../lib/download.ts";
import { formatError } from "../../lib/formatError.ts";

/**
 * The building page's header: a breadcrumb back to the buildings list, the
 * building name + address, the producing-organisation attribution (the same
 * `attributedTo` AgentLabel the read view / map hover card surface), an
 * owned/shared badge, and a small locator map thumbnail (the main map's basemap
 * + an ownership-coloured pin).
 */
export default function BuildingHeader({ building }: { building: Building }) {
  const name = buildingDisplayName(building);
  const address = buildingAddressLine(building);
  const shared = building.isShared ?? false;
  // The building's source document (its backing Pod resource) — shown inline in the
  // title row as a dev-only source link (RdfSourceLink self-hides outside dev mode),
  // the same place the finders surface their container URI.
  const sourceUri = buildingFileUri(building.sourceUri ?? building.uri);
  const hasCoords = building.lat != null && building.long != null;
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
      {/* Back to wherever the user arrived from (an agent's buildings, the map, a
          finder), falling back to the buildings finder for a deep link. */}
      <Box sx={{ mb: 1 }}>
        <BackLink fallback={FINDERS.buildings} />
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
            <TierBadge tier={shared ? "shared" : "mine"} />
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
          {/* The building's backing document (dev-only; RdfSourceLink self-hides) —
              after the address, before the coordinate provenance below. */}
          <Box sx={{ mt: 0.5 }}>
            <RdfSourceLink href={sourceUri} />
          </Box>
          {building.attributedTo && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5 }}
            >
              {msg("dataSourceLabel")} <AgentLabel value={building.attributedTo} />
            </Typography>
          )}
          {/* The coordinates were geocoded from OpenStreetMap (Nominatim) iff a
              precision is set — record the ODbL attribution that travels with the
              shared building (see the geo:Point prov:wasDerivedFrom in Turtle). */}
          {building.geocodePrecision && (
            <Box sx={{ mt: 0.5 }}>
              <SourceNote sources={SOURCES.osm} label={msg("coordsLabel")} />
            </Box>
          )}
        </Box>

        {/* Interactive locator map (the shared LocatorMap widget) — hidden when
            the building has no coordinates. */}
        {hasCoords && (
          <LocatorMap
            lat={building.lat as number}
            long={building.long as number}
            shared={shared}
          />
        )}
      </Stack>
    </Box>
  );
}

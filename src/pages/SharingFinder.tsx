import { sessionGateway } from "../services/pod/podGateway.ts";
import { useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { BuildingType } from "../types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { logError } from "../lib/logError.ts";
import { formatError } from "../lib/formatError.ts";
import {
  useReceivedAggregations,
  useSharedBuildingDetail,
  useSharedWithMe,
  useSolidData,
} from "../hooks/queries.ts";
import { useCheckInbox, useToggleVisibility } from "../hooks/mutations.ts";
import { loadSharedBuilding } from "../services/interop/sharedBuilding.ts";
import { attachAnnualData } from "../services/rdf/building/buildingSerializer.ts";
import {
  buildingsToXlsx,
  buildingToXlsx,
} from "../services/xlsx/buildingWorkbook.ts";
import { downloadXlsx } from "../lib/download.ts";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { buildingFileUri } from "../services/rdf/building/buildingId.ts";
import { buildingRoute } from "../routes.ts";
import {
  RdfSourceLink,
  RefLink,
} from "../components/detail/DetailView.tsx";
import { AgentLabel } from "../components/AgentLabel.tsx";
import { useT } from "../context/I18nProvider.tsx";
import { msg } from "../lib/messages.ts";
import FilesSection from "../components/detail/FilesSection.tsx";
import { useDevMode } from "../hooks/devMode.ts";
import ResourceRow from "../components/ResourceRow.tsx";
import ReceivedAggregationRow from "../components/aggregation/ReceivedAggregationRow.tsx";
import Pager from "../components/Pager.tsx";
import { usePaging } from "../hooks/usePaging.ts";
import { useListSearch } from "../hooks/useListSearch.ts";
import SearchField from "../components/SearchField.tsx";
import { filterByText } from "../lib/textSearch.ts";

interface SharingFinderProps {
  session: Session;
}

/**
 * Files attached to a building shared with you: load the building lazily (its
 * attachments aren't in the lightweight shared-list entry) and render the shared
 * FilesSection, whose download fetches each binary with the recipient's own
 * session. Renders nothing while loading or when the building has no files.
 */
function SharedBuildingFiles(
  { entry }: { entry: { buildingUri: string; buildingId: string } },
) {
  const building = useSharedBuildingDetail(entry).data ?? null;
  return building ? <FilesSection building={building} /> : null;
}

/**
 * The SHARE tab: a pure inbox of what others have shared with you. Outgoing
 * sharing (your buildings and aggregations) lives on the MANAGE tab.
 */
export default function SharingFinder({ session }: SharingFinderProps) {
  const { showNotification } = useNotification();
  const dev = useDevMode();
  const t = useT();

  const sharedWithMeQuery = useSharedWithMe();
  const sharedWithMe = sharedWithMeQuery.data ?? [];
  const loading = sharedWithMeQuery.isLoading;
  const sharedSearch = useListSearch("shared");
  const filteredShared = filterByText(
    sharedWithMe,
    sharedSearch.query,
    (b) => `${b.buildingId} ${b.sharedBy}`,
  );
  const sharedPaging = usePaging(filteredShared, { key: "shared" });

  // The shared-with-me ENTRIES carry only a display stem (`buildingId`) and the
  // building's document URI; the resolvable building id (the absolute subject IRI
  // the /building/:id route expects) lives on the folded `useSolidData` building.
  // Key those by their document URI so a row can link to the detail page when the
  // building is loaded and readable (an inaccessible one stays unlinked).
  const { buildings } = useSolidData();
  const idByFileUri = new Map(
    buildings.map((b) => [buildingFileUri(b.id), b.id]),
  );

  const receivedAggregationsQuery = useReceivedAggregations();
  const receivedAggregations = receivedAggregationsQuery.data ?? [];
  const receivedSearch = useListSearch("received");
  const filteredReceived = filterByText(
    receivedAggregations,
    receivedSearch.query,
    (a) => `${a.aggregationId} ${a.sharedBy}`,
  );
  const receivedAggregationsPaging = usePaging(filteredReceived, {
    key: "received",
  });

  const toggleVis = useToggleVisibility();
  const checkInbox = useCheckInbox();
  const [bundling, setBundling] = useState(false);

  // Dev-mode: drain the inbox on demand (it otherwise only happens at
  // login/reload), then surface the outcome.
  const handleCheckInbox = () =>
    checkInbox.mutate(undefined, {
      onSuccess: () => showNotification(msg("checkedForShares"), "success"),
      onError: (err) =>
        showNotification(formatError("actionCheckShares", err), "error"),
    });

  // The Solid containers that back this tab, so the user can open the raw RDF:
  // shared-in/ backs "Buildings shared with you" (linked under that heading), and
  // inbox/ is linked in its own section below. `inbox` here is the convention path
  // (where ensureOwnInbox provisions it); the live location is discoverable but the
  // default is correct in practice. null until the storage root resolves.
  const webId = session.info.webId;
  const collections = webId ? tryPodResources(webId) : null;

  const handleDownloadBuilding = async (entry: {
    buildingUri: string;
    buildingId: string;
  }) => {
    try {
      const building = await loadSharedBuilding(entry, sessionGateway(session));
      if (!building) throw new Error("no building data found in the source file");
      const [enriched] = await attachAnnualData([building], sessionGateway(session));
      downloadXlsx(await buildingToXlsx(enriched), `building-${entry.buildingId}.xlsx`);
    } catch (error) {
      showNotification(formatError("actionExportBuilding", error), "error");
    }
  };

  // Bundle every shared building into one multi-sheet workbook. Unreadable ones
  // (e.g. access revoked since the grant) are skipped, not fatal.
  const handleDownloadAll = async () => {
    if (sharedWithMe.length === 0) return;
    setBundling(true);
    try {
      const built: BuildingType[] = [];
      for (const entry of sharedWithMe) {
        try {
          const b = await loadSharedBuilding(entry, sessionGateway(session));
          if (b) built.push(b);
        } catch (err) {
          logError("read shared building for bundle", err);
          // skip a building that can't be read right now
        }
      }
      if (built.length === 0) {
        throw new Error("none of the shared buildings could be read");
      }
      const enriched = await attachAnnualData(built, sessionGateway(session));
      downloadXlsx(await buildingsToXlsx(enriched), "buildings-shared.xlsx");
      if (built.length < sharedWithMe.length) {
        showNotification(
          `Exported ${built.length} of ${sharedWithMe.length} buildings; the rest could not be read.`,
          "info",
        );
      }
    } catch (error) {
      showNotification(formatError("actionExportBuildings", error), "error");
    } finally {
      setBundling(false);
    }
  };

  const handleToggleVisibility = (buildingUri: string) =>
    toggleVis.mutate(buildingUri);

  return (
    <Box component="section" sx={{ p: 3, flexGrow: 1, minHeight: 0, overflow: "auto" }}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        {t("sharedBuildingsHeading")}
      </Typography>
      {collections && <RdfSourceLink href={collections.sharedIn} />}
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ flexWrap: "wrap", alignItems: "center", mb: 1 }}
      >
        {dev && (
          <Button
            variant="outlined"
            onClick={handleCheckInbox}
            disabled={checkInbox.isPending}
          >
            {checkInbox.isPending ? t("shareChecking") : t("shareCheckForNew")}
          </Button>
        )}
        <Button
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={handleDownloadAll}
          disabled={bundling || sharedWithMe.length === 0}
        >
          {bundling ? t("sharePreparing") : t("bldgsDownloadAll")}
        </Button>
      </Stack>
      {sharedWithMe.length > 0 && (
        <Box sx={{ mb: 1 }}>
          <SearchField
            value={sharedSearch.query}
            onChange={sharedSearch.setQuery}
          />
        </Box>
      )}
      {loading
        ? <Typography variant="body2">{t("loadingEllipsis")}</Typography>
        : sharedWithMe.length === 0
        ? (
          <Typography variant="body2">
            {t("sharedBuildingsEmpty")}
          </Typography>
        )
        : filteredShared.length === 0
        ? (
          <Typography variant="body2">
            {t("searchNoMatches", { query: sharedSearch.query })}
          </Typography>
        )
        : (
          <Box
            component="ul"
            aria-label={t("sharedBuildingsHeading")}
            sx={{ listStyle: "none", pl: 0, m: 0 }}
          >
            {sharedPaging.pageItems.map((building) => {
              const resolvableId = idByFileUri.get(building.buildingUri);
              return (
              <ResourceRow
                key={building.buildingUri}
                title={
                  <>
                    {resolvableId
                      ? (
                        <RefLink
                          to={buildingRoute(resolvableId)}
                        >
                          {t("shareBuildingN", { id: building.buildingId })}
                        </RefLink>
                      )
                      : <>{t("shareBuildingN", { id: building.buildingId })}</>}
                    <RdfSourceLink href={building.buildingUri} inline />
                  </>
                }
                subtitle={<>{t("shareSharedBy")} <AgentLabel value={building.sharedBy} /></>}
                actions={
                  <>
                    <Tooltip title={t("shareDownloadBuildingTooltip")}>
                      <IconButton
                        size="small"
                        aria-label={t("shareDownloadBuildingAria")}
                        onClick={() => handleDownloadBuilding(building)}
                      >
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t("shareVisibilityTooltip")}>
                      <Box
                        component="label"
                        sx={{ display: "inline-flex", alignItems: "center" }}
                      >
                        <Switch
                          checked={building.isVisible}
                          onChange={() =>
                            handleToggleVisibility(building.buildingUri)}
                          disabled={toggleVis.isPending &&
                            toggleVis.variables === building.buildingUri}
                          icon={<VisibilityOffIcon />}
                          checkedIcon={<VisibilityIcon />}
                        />
                        {building.isVisible ? t("shareShown") : t("shareHidden")}
                      </Box>
                    </Tooltip>
                  </>
                }
                expansion={<SharedBuildingFiles entry={building} />}
              />
              );
            })}
          </Box>
        )}
      <Pager paging={sharedPaging} />

      <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
        {t("sharedAggregationsHeading")}
      </Typography>
      {receivedAggregations.length > 0 && (
        <Box sx={{ mb: 1 }}>
          <SearchField
            value={receivedSearch.query}
            onChange={receivedSearch.setQuery}
          />
        </Box>
      )}
      {receivedAggregationsQuery.isLoading
        ? <Typography variant="body2">{t("loadingEllipsis")}</Typography>
        : receivedAggregations.length === 0
        ? (
          <Typography variant="body2">
            {t("sharedAggregationsEmpty")}
          </Typography>
        )
        : filteredReceived.length === 0
        ? (
          <Typography variant="body2">
            {t("searchNoMatches", { query: receivedSearch.query })}
          </Typography>
        )
        : (
          <Box
            component="ul"
            aria-label={t("sharedAggregationsHeading")}
            sx={{ listStyle: "none", pl: 0, m: 0 }}
          >
            {receivedAggregationsPaging.pageItems.map((aggregation) => (
              <ReceivedAggregationRow key={aggregation.snapshotUri} aggregation={aggregation} />
            ))}
          </Box>
        )}
      <Pager paging={receivedAggregationsPaging} />

      {/* Your inbox — the receiving endpoint others post to when they share with
          you. Notices are drained into shared-in/ and surface in the lists above.
          Developer-mode only: this exposes the raw transport container. */}
      {dev && collections && (
        <>
          <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>{t("headingInbox")}</Typography>
          <RdfSourceLink href={collections.inbox} />
        </>
      )}
    </Box>
  );
}

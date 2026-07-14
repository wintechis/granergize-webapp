import { useState } from "react";
import { getGateway } from "../hooks/session.ts";
import { Box, Button, Switch, Tooltip, Typography } from "@mui/material";
import FinderHeader from "../components/FinderHeader.tsx";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { Building } from "../types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { logError } from "../lib/logError.ts";
import { formatError } from "../lib/formatError.ts";
import { useSharedWithMe, useSolidData } from "../hooks/queries.ts";
import { useCheckInbox, useToggleVisibility } from "../hooks/mutations.ts";
import { loadSharedBuilding } from "../services/interop/sharedBuilding.ts";
import { attachAnnualData } from "../services/rdf/building/buildingSerializer.ts";
import { buildingsToXlsx } from "../services/xlsx/buildingWorkbook.ts";
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
import { useDevMode } from "../hooks/devMode.ts";
import ResourceRow from "../components/ResourceRow.tsx";
import Pager from "../components/Pager.tsx";
import { usePaging } from "../hooks/usePaging.ts";
import { useListSearch } from "../hooks/useListSearch.ts";
import SearchField from "../components/SearchField.tsx";
import { filterByText } from "../lib/textSearch.ts";

interface SharingFinderProps {
  session: Session;
}

/**
 * The SHARING finder: the **relationship** view of what others have shared with
 * you — a lean audit of incoming building grants (who shared what, and the
 * show/hide visibility you control), plus the inbox. The shared content itself is
 * browsed in its own collection finder: shared *buildings* in the Buildings finder
 * (Shared tier — open one for its files/download/detail), shared *aggregations* in
 * the Aggregations finder (Shared tier). This finder is therefore *manage*, not
 * *browse* (plan-finder-collection-model Slice 5). Outgoing sharing surfaces as the
 * "Shared with" badges on the Buildings/Aggregations finder rows.
 */
export default function SharingFinder({ session }: SharingFinderProps) {
  const { showNotification } = useNotification();
  const dev = useDevMode();
  const t = useT();

  const sharedWithMeQuery = useSharedWithMe();
  const sharedWithMe = sharedWithMeQuery.data ?? [];
  const loading = sharedWithMeQuery.isLoading;
  // One list on this page → the bare `?q=` / `?offset=` params, like every other
  // single-list finder (no `shared_`-prefixed key).
  const sharedSearch = useListSearch();
  const filteredShared = filterByText(
    sharedWithMe,
    sharedSearch.query,
    (b) => `${b.buildingId} ${b.sharedBy}`,
  );
  const sharedPaging = usePaging(filteredShared);

  // The shared-with-me ENTRIES carry only a display stem (`buildingId`) and the
  // building's document URI; the resolvable building id (the absolute subject IRI
  // the /building/:id route expects) lives on the folded `useSolidData` building.
  // Key those by their document URI so a row can link to the detail page when the
  // building is loaded and readable (an inaccessible one stays unlinked).
  const { buildings } = useSolidData();
  const idByFileUri = new Map(
    buildings.map((b) => [buildingFileUri(b.id), b.id]),
  );

  const toggleVis = useToggleVisibility();
  const checkInbox = useCheckInbox();
  const [bundling, setBundling] = useState(false);

  // Dev-mode: drain the inbox on demand (it otherwise only happens at
  // login/reload), then surface the outcome.
  const handleCheckInbox = () =>
    checkInbox.mutate(undefined, {
      // Errors go to the central toast via the hook's meta.action.
      onSuccess: () => showNotification(msg("checkedForShares"), "success"),
    });

  // The Solid containers that back this tab, so the user can open the raw RDF:
  // shared-in/ backs "Buildings shared with you" (linked under that heading), and
  // inbox/ is linked in its own section below. `inbox` here is the convention path
  // (where ensureOwnInbox provisions it); the live location is discoverable but the
  // default is correct in practice. null until the storage root resolves.
  const webId = session.info.webId;
  const collections = webId ? tryPodResources(webId) : null;

  // Bundle every shared building into one multi-sheet workbook. Unreadable ones
  // (e.g. access revoked since the grant) are skipped, not fatal. Bulk export of
  // the incoming set has no per-collection equivalent, so it stays here.
  const handleDownloadAll = async () => {
    if (sharedWithMe.length === 0) return;
    setBundling(true);
    try {
      const built: Building[] = [];
      for (const entry of sharedWithMe) {
        try {
          const b = await loadSharedBuilding(entry, getGateway());
          if (b) built.push(b);
        } catch (err) {
          logError("read shared building for bundle", err);
          // skip a building that can't be read right now
        }
      }
      if (built.length === 0) {
        throw new Error("none of the shared buildings could be read");
      }
      const enriched = await attachAnnualData(built, getGateway());
      downloadXlsx(await buildingsToXlsx(enriched), "buildings-shared.xlsx");
      if (built.length < sharedWithMe.length) {
        showNotification(
          msg("exportedBuildingsPartial", {
            done: built.length,
            total: sharedWithMe.length,
          }),
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
    <FinderHeader
      title={t("sharedBuildingsHeading")}
      count={sharedWithMe.length}
      source={collections?.sharedIn}
      actions={
        <>
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
        </>
      }
      controls={sharedWithMe.length > 0 && (
        <SearchField
          value={sharedSearch.query}
          onChange={sharedSearch.setQuery}
        />
      )}
    >
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
                          <RefLink to={buildingRoute(resolvableId)}>
                            {t("shareBuildingN", { id: building.buildingId })}
                          </RefLink>
                        )
                        : <>{t("shareBuildingN", { id: building.buildingId })}</>}
                      <RdfSourceLink href={building.buildingUri} inline />
                    </>
                  }
                  subtitle={<>{t("shareSharedBy")} <AgentLabel value={building.sharedBy} /></>}
                  actions={
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
                  }
                />
              );
            })}
          </Box>
        )}
      <Pager paging={sharedPaging} />

      {/* Your inbox — the receiving endpoint others post to when they share with
          you. Notices are drained into shared-in/ and surface in the list above
          and in the Buildings/Aggregations finders' Shared tiers. Developer-mode
          only: this exposes the raw transport container. */}
      {dev && collections && (
        <>
          <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>{t("headingInbox")}</Typography>
          <RdfSourceLink href={collections.inbox} />
        </>
      )}
    </FinderHeader>
  );
}

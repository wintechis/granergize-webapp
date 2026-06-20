import { sessionGateway } from "../services/pod/podGateway.ts";
import { lazy, Suspense, useMemo, useState } from "react";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  Button,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DownloadIcon from "@mui/icons-material/Download";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { BuildingType } from "../types.ts";
import { buildingDisplayName, buildingSearchText } from "../lib/buildingDisplay.ts";
import { filterByText } from "../lib/textSearch.ts";
import { useListSearch } from "../hooks/useListSearch.ts";
import { useListFacet } from "../hooks/useListFacet.ts";
import SearchField from "../components/SearchField.tsx";
import TierFilter from "../components/TierFilter.tsx";
import { BUILDING_TIERS } from "../constants/tiers.ts";
import { buildingFileUri } from "../services/rdf/building/buildingId.ts";
import { buildingRoute } from "../routes.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useT } from "../context/I18nProvider.tsx";
import { msg } from "../lib/messages.ts";
import { useConfirm } from "../context/ConfirmContext.tsx";
import { useSharedBuildings, useSolidData } from "../hooks/queries.ts";
import {
  useDeleteBuilding,
  useRevokeBuildingAccess,
} from "../hooks/mutations.ts";
import { attachAnnualData } from "../services/rdf/building/buildingSerializer.ts";
import { buildingsToXlsx } from "../services/xlsx/buildingWorkbook.ts";
import { buildBuildingDeletionPreview } from "../services/buildingActions.ts";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { formatError } from "../lib/formatError.ts";
import { downloadXlsx } from "../lib/download.ts";
import {
  RdfSourceLink,
  RefLink,
} from "../components/detail/DetailView.tsx";
import ResourceRow from "../components/ResourceRow.tsx";
import ObjectActions from "../components/ObjectActions.tsx";
import Pager from "../components/Pager.tsx";
import NestedAgentList from "../components/NestedAgentList.tsx";
import { usePaging } from "../hooks/usePaging.ts";
import AddBuildingDialog from "../components/AddBuildingDialog.tsx";
import { ShareBuildingDialog } from "../components/BuildingDialogs.tsx";
import TierDot from "../components/TierDot.tsx";

const ExplorePage = lazy(() => import("./ExplorePage.tsx"));

interface BuildingsFinderProps {
  session: Session;
}

/**
 * The Buildings finder (`/buildings`): one finder over two views of the same set,
 * picked by a Map ⇄ List toggle (local, non-URL state; defaults to Map). Map is
 * `ExplorePage` (kept mounted-but-hidden on List so the Leaflet instance and map
 * viewport survive the toggle) — a pure finder whose markers navigate to the
 * building page like a List row; List is the buildings list —
 * each row navigates to the building page (`/building/:id`, where edit / files /
 * energy / share / download live) and carries one destructive action (delete),
 * showing who it's shared with (and revoking). Aggregations are their OWN finder
 * (`/aggregations`) now, not a section here.
 */
export default function BuildingsFinder({ session }: BuildingsFinderProps) {
  // The Map ⇄ List view is URL state (`?view=list`; Map is the default → implicit),
  // so a reload/share/Back keeps the chosen view. Map and List carry their own
  // orthogonal params (the map's ?c=&z=, the list's ?offset=).
  const [searchParams, setSearchParams] = useSearchParams();
  const buildingsView: "map" | "list" =
    searchParams.get("view") === "list" ? "list" : "map";
  const setBuildingsView = (next: "map" | "list") => {
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      if (next === "map") sp.delete("view");
      else sp.set("view", "list");
      return sp;
    });
  };
  // The finder only renders on /buildings (the shell unmounts it otherwise), so
  // the map is "active" whenever Map is the chosen view; the pathname guard keeps
  // the prop honest even if a parent kept us mounted.
  const onBuildings = useLocation().pathname === "/buildings";

  const { showNotification } = useNotification();
  const { confirm } = useConfirm();
  const { buildings, isLoading: buildingsLoading } = useSolidData();
  // The List guise shows the SAME reachable set the Map does — own + shared-with-me
  // (Slice 1, plan-finder-collection-model: membership is guise-invariant). `ownedBuildings`
  // is kept only for the own-only "Download all".
  const ownedBuildings = buildings.filter((b) => !b.isShared);
  const { query, setQuery } = useListSearch();
  // Tier source-selector (Slice 2): union the ticked provenance tiers. Default both
  // → the full reachable set (matching the Map). A building's tier is own vs shared.
  const tierFacet = useListFacet("tiers", BUILDING_TIERS);
  const byTier = buildings.filter((b) =>
    tierFacet.isSelected(b.isShared ? "shared" : "mine")
  );
  const filteredBuildings = filterByText(byTier, query, buildingSearchText);
  const buildingPaging = usePaging(filteredBuildings);
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;
  const t = useT();

  const [addOpen, setAddOpen] = useState(false);
  const [importMode, setImportMode] = useState(false);
  // The building whose Share dialog is open (a finder-row action, next to delete).
  const [shareBuilding, setShareBuilding] = useState<BuildingType | null>(null);

  // Honour a palette-routed `?action=add` by DERIVING the dialog-open state from
  // the URL (no setState-in-effect): the palette routes the rich create verb to
  // the finder that owns its bespoke dialog (plan-palette §5). The close handler
  // strips the param so a reload/Back doesn't re-open it.
  const actionIsAdd = searchParams.get("action") === "add";
  const clearAction = () =>
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      sp.delete("action");
      return sp;
    }, { replace: true });
  const closeAdd = () => {
    setAddOpen(false);
    if (actionIsAdd) clearAction();
  };

  // buildingUri → WebIDs it is shared with.
  const sharedQuery = useSharedBuildings();
  const recipients = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const s of sharedQuery.data ?? []) map[s.buildingUri] = s.sharedWith;
    return map;
  }, [sharedQuery.data]);

  const deleteBuilding = useDeleteBuilding();
  const revoke = useRevokeBuildingAccess();

  const handleDelete = async (building: BuildingType) => {
    // Build the "what will be removed" preview, confirm, then delete (the
    // confirm lives here, not in the service — same pattern as handleRevoke).
    const { message } = await buildBuildingDeletionPreview(sessionGateway(session), building);
    if (!await confirm({ title: msg("dlgDeleteBuilding"), message, confirmLabel: msg("btnDelete") })) {
      return;
    }
    deleteBuilding.mutate(building, {
      onSuccess: () => showNotification(msg("buildingDeleted"), "success"),
    });
  };

  const handleRevoke = async (buildingUri: string, webId: string) => {
    if (
      !await confirm({
        title: msg("dlgRevokeAccess"),
        message: msg("confirmRevokeMessage", { webId }),
        confirmLabel: msg("confirmRevoke"),
      })
    ) return;
    revoke.mutate({ buildingUri, webId }, {
      onSuccess: () => showNotification(msg("accessRevoked"), "success"),
    });
  };

  const handleDownloadAll = async () => {
    if (ownedBuildings.length === 0) return;
    try {
      const enriched = await attachAnnualData(ownedBuildings, sessionGateway(session));
      downloadXlsx(await buildingsToXlsx(enriched), "buildings-mine.xlsx");
    } catch (error) {
      showNotification(formatError("actionExportBuildings", error), "error");
    }
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        flexGrow: 1,
        minHeight: 0,
      }}
    >
      {/* Shared collection chrome: the heading + identity, the collection-level
          actions (add / autofill / download-all), the view toggle, and the
          search / tier facet — rendered ONCE here (not per guise) so they show in
          BOTH Map and List. These are collection-level capabilities
          (plan-finder-collection-model), so they must not hide inside one view. */}
      <Box sx={{ p: 1, flexShrink: 0 }}>
        {/* Heading + identity + actions — left-aligned, visible in both views. */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 1.5,
            mb: 1.5,
          }}
        >
          <Typography variant="h6">{t("headingYourBuildings")}</Typography>
          {rdf && <RdfSourceLink href={rdf.buildings} />}
          <Box sx={{ flexGrow: 1 }} />
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => {
              setImportMode(false);
              setAddOpen(true);
            }}
          >
            {t("addBuildingBtn")}
          </Button>
          <Button
            variant="outlined"
            startIcon={<UploadFileIcon />}
            onClick={() => {
              setImportMode(true);
              setAddOpen(true);
            }}
          >
            {t("bldgsAutofillFromFile")}
          </Button>
          <Button
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleDownloadAll}
            disabled={ownedBuildings.length === 0}
          >
            {t("bldgsDownloadAll")}
          </Button>
        </Box>
        {/* View controls — centered. */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 1.5,
          }}
        >
          <ToggleButtonGroup
            size="small"
            exclusive
            value={buildingsView}
            onChange={(_e, next) => {
              if (next) setBuildingsView(next); // ignore deselect of the active button
            }}
            aria-label={t("bldgsViewAria")}
          >
            <ToggleButton value="map">{t("btnMap")}</ToggleButton>
            <ToggleButton value="list">{t("btnList")}</ToggleButton>
          </ToggleButtonGroup>
          {buildings.length > 0 && (
            <SearchField value={query} onChange={setQuery} />
          )}
          {/* The tier selector is always offered (whenever there are buildings),
              even with a single tier, so the source-tier affordance stays
              discoverable — ticking "shared" with nothing shared simply shows none. */}
          {buildings.length > 0 && (
            <TierFilter
              facet={tierFacet}
              options={BUILDING_TIERS}
              counts={{
                mine: ownedBuildings.length,
                shared: buildings.length - ownedBuildings.length,
              }}
            />
          )}
        </Box>
      </Box>
      {/* Map: kept mounted whenever Buildings is the finder (only hidden when
          switched to List), preserving ExplorePage's Leaflet instance + map state. */}
      <Box
        sx={{
          display: buildingsView === "map" ? "flex" : "none",
          flexDirection: "column",
          flexGrow: 1,
          minHeight: 0,
        }}
      >
        <Suspense fallback={<CircularProgress sx={{ mt: 4, ml: 4 }} />}>
          <ExplorePage active={onBuildings && buildingsView === "map"} />
        </Suspense>
      </Box>
      {/* List: mounted only while showing — no costly instance to preserve. */}
      {buildingsView === "list" && (
        <Box sx={{ flexGrow: 1, minHeight: 0, overflow: "auto" }}>
          <Box component="section" sx={{ p: 3 }}>
            {buildingsLoading
              ? <Typography variant="body2">{t("loadingEllipsis")}</Typography>
              : buildings.length === 0
              ? (
                <Typography variant="body2">
                  {t("buildingsEmpty")}
                </Typography>
              )
              : filteredBuildings.length === 0
              ? (
                <Typography variant="body2">
                  {query ? t("searchNoMatches", { query }) : t("filterNoMatch")}
                </Typography>
              )
              : (
                <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
                  {buildingPaging.pageItems.map((b) => {
                    const fileUri = buildingFileUri(b.sourceUri ?? b.uri);
                    const sharedWith = recipients[fileUri] ?? recipients[b.uri] ??
                      [];
                    const name = buildingDisplayName(b);
                    return (
                      // data-building-id: the row shows the DISPLAY name (label /
                      // address), so the e2e suite resolves a row's id from this
                      // attribute instead of parsing the old "Building <id>" text.
                      <ResourceRow
                        key={b.uri}
                        buildingId={b.id}
                        title={
                          <>
                            <RefLink
                              to={buildingRoute(b.id)}
                            >
                              <strong>{name}</strong>
                            </RefLink>
                            {b.streetAddress && b.streetAddress !== name
                              ? ` — ${b.streetAddress}`
                              : ""}
                            {/* Source-tier dot (mine = owned blue, shared = orange) —
                                the same key the tier filter + Aggregations list wear. */}
                            <TierDot tier={b.isShared ? "shared" : "mine"} />
                            <RdfSourceLink href={b.uri as string} inline />
                          </>
                        }
                        actions={
                          // Registry-driven, owner-only via the registry's `applies()`
                          // guard: Share (opens the share dialog for this row) sits
                          // beside Delete; Edit / Files / energy / Download live on the
                          // building page (/building/:id).
                          <ObjectActions
                            object={b}
                            handlers={{
                              ShareBuilding: () => setShareBuilding(b),
                              DeleteBuilding: () => {
                                void handleDelete(b);
                              },
                            }}
                            pending={(name) =>
                              name === "DeleteBuilding" &&
                              deleteBuilding.isPending &&
                              deleteBuilding.variables?.uri === b.uri}
                          />
                        }
                      >
                        {/* "Shared with" (recipients) is owner-only — a shared-with-me
                            building isn't mine to have shared out. */}
                        {b.isShared
                          ? null
                          : sharedQuery.isLoading
                          ? (
                            <Typography variant="caption" color="text.secondary">
                              Shared with: Loading…
                            </Typography>
                          )
                          : (
                            <NestedAgentList
                              agents={sharedWith}
                              label={t("sharedWithLabel")}
                              onRevoke={(webId) => handleRevoke(fileUri, webId)}
                              isRevoking={(webId) =>
                                revoke.isPending &&
                                revoke.variables?.buildingUri === fileUri &&
                                revoke.variables?.webId === webId}
                            />
                          )}
                      </ResourceRow>
                    );
                  })}
                </Box>
              )}
            <Pager paging={buildingPaging} />
          </Box>
        </Box>
      )}
      <AddBuildingDialog
        open={addOpen || actionIsAdd}
        autostartImport={importMode}
        onClose={closeAdd}
      />
      {shareBuilding && (
        <ShareBuildingDialog
          open
          buildingUri={(shareBuilding.sourceUri ?? shareBuilding.uri) as string}
          building={shareBuilding}
          session={session}
          onClose={() => setShareBuilding(null)}
        />
      )}
    </Box>
  );
}

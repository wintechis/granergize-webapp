import { sessionGateway } from "../services/pod/podGateway.ts";
import { lazy, Suspense, useMemo, useState } from "react";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  Button,
  MenuItem,
  TextField,
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
import {
  useAnnualEnergyByYear,
  useSharedBuildings,
  useSolidData,
} from "../hooks/queries.ts";
import {
  type CubeAxes,
  resolveAxes,
  showsMetric,
  toParams,
} from "../services/cube/exploreAxes.ts";
import CubeAxisBar from "../components/cube/CubeAxisBar.tsx";
import BuildingsMatrix from "../components/building/BuildingsMatrix.tsx";
import {
  clampMetric,
  metricLabelKey,
  SELECTABLE_METRICS,
} from "../services/energy/energyMetric.ts";
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
import FinderHeader from "../components/FinderHeader.tsx";

const BuildingsMap = lazy(() => import("../components/building/BuildingsMap.tsx"));

interface BuildingsFinderProps {
  session: Session;
}

/**
 * The Buildings finder (`/buildings`): a data cube over the same building set,
 * shown through two orthogonal axes (`?space`/`?colour`, see `services/cube/
 * exploreAxes.ts`). Space = Map ⇄ List; Colour = Ownership ⇄ Energy → four views:
 * the ownership/energy `BuildingsMap` (kept mounted-but-hidden off-map so the
 * Leaflet viewport survives), the actionable List (each row navigates to
 * `/building/:id` — edit / files / energy / share / download — and carries delete +
 * shared-with revoke), and the `BuildingsMatrix` efficiency-over-time heatmap. Every
 * surface's markers/rows navigate to the building page. Aggregations are their OWN
 * finder (`/aggregations`) now, not a section here.
 */
export default function BuildingsFinder({ session }: BuildingsFinderProps) {
  // The cube's two orthogonal view axes are URL state (`?space=`/`?colour=`, the
  // ownership map being the implicit default), so a reload/share/Back keeps the
  // view. Map and List carry their own orthogonal params (the map's ?c=&z=, the
  // list's ?offset=, the energy ?m=&y=).
  const [searchParams, setSearchParams] = useSearchParams();
  const axes = resolveAxes(searchParams);
  const setAxes = (next: Partial<CubeAxes>) =>
    setSearchParams((prev) => toParams({ ...axes, ...next }, prev));
  // The finder only renders on /buildings (the shell unmounts it otherwise), so
  // the map is "active" whenever Space=map; the pathname guard keeps the prop
  // honest even if a parent kept us mounted.
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
  // The energy metric (?m) — the cube's measure axis — shared by the map's bands,
  // the over-time heatmap, and the (finder-owned) metric selector.
  const metric = clampMetric(searchParams.get("m"));
  const setMetric = (m: string) =>
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      sp.set("m", m);
      return sp;
    }, { replace: true });
  // The over-time heatmap (rows + energy) re-colours over the per-year energy cube,
  // banded against the filtered set as peers. Loaded only when that view is up.
  const heatmapOn = axes.space === "rows" && axes.colour === "energy";
  const { data: energyByYear } = useAnnualEnergyByYear(buildings, heatmapOn);
  const visibleIds = useMemo(
    () => new Set(filteredBuildings.map((b) => b.id)),
    [filteredBuildings],
  );
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
    <FinderHeader
      title={t("navBuildings")}
      source={rdf?.buildings}
        actions={
          <>
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
          </>
        }
        controls={
          <>
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
            <Box sx={{ flexGrow: 1 }} />
            <CubeAxisBar
              space={{
                value: axes.space,
                ariaLabel: t("bldgsViewAria"),
                onChange: (space) => setAxes({ space }),
                options: [
                  { value: "map", label: t("btnMap") },
                  { value: "rows", label: t("btnList") },
                ],
              }}
              colour={{
                value: axes.colour,
                ariaLabel: msg("lensAria"),
                onChange: (colour) => setAxes({ colour }),
                options: [
                  { value: "ownership", label: msg("lensOwnership") },
                  { value: "energy", label: msg("lensEnergy") },
                ],
              }}
              metricSlot={showsMetric(axes)
                ? (
                  <TextField
                    select
                    size="small"
                    value={metric}
                    onChange={(e) => setMetric(e.target.value)}
                    label={t("metricSelectLabel")}
                    sx={{ minWidth: 160 }}
                  >
                    {SELECTABLE_METRICS.map((m) => (
                      <MenuItem key={m.key} value={m.key}>
                        {t(metricLabelKey(m.key))}
                      </MenuItem>
                    ))}
                  </TextField>
                )
                : undefined}
            />
          </>
        }
      >
        {/* Space=map: a fixed-size map (same height as the Aggregations map), kept
            mounted — only hidden on the rows surfaces — to preserve the Leaflet
            instance + viewport. Its markers colour by the resolved Colour axis. */}
        <Box
          sx={{
            display: axes.space === "map" ? "flex" : "none",
            flexDirection: "column",
            height: 480,
            borderRadius: 1,
            overflow: "hidden",
          }}
        >
          <Suspense fallback={<CircularProgress sx={{ mt: 4, ml: 4 }} />}>
            <BuildingsMap
              active={onBuildings && axes.space === "map"}
              colour={axes.colour}
            />
          </Suspense>
        </Box>
      {/* Space=rows + Colour=energy: the efficiency-over-time heatmap (building ×
          year), banded against the filtered set. Mounted only while shown. */}
      {axes.space === "rows" && axes.colour === "energy" && (
        <Box sx={{ minHeight: 0, overflow: "auto" }}>
          <BuildingsMatrix
            buildings={filteredBuildings}
            energyByYear={energyByYear}
            visibleIds={visibleIds}
            metric={metric}
          />
        </Box>
      )}
      {/* Space=rows + Colour=ownership: the actionable List (tier dots + actions). */}
      {axes.space === "rows" && axes.colour === "ownership" && (
        <>
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
                              {t("sharedWithLabel")} {t("loadingEllipsis")}
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
        </>
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
    </FinderHeader>
  );
}

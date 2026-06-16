import { lazy, Suspense, useMemo, useState } from "react";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  Button,
  Stack,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { BuildingType } from "../types.ts";
import { buildingDisplayName } from "../lib/buildingDisplay.ts";
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
import { buildingsToXlsx } from "../services/rdf/buildingWorkbook.ts";
import { buildBuildingDeletionPreview } from "../services/buildingActions.ts";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { formatError } from "../lib/formatError.ts";
import { downloadXlsx } from "../lib/download.ts";
import {
  RdfSourceLink,
  RefLink,
} from "../components/detail/DetailView.tsx";
import ResourceRow from "../components/ResourceRow.tsx";
import RowAction from "../components/RowAction.tsx";
import Pager from "../components/Pager.tsx";
import NestedAgentList from "../components/NestedAgentList.tsx";
import { usePaging } from "../hooks/usePaging.ts";
import AddBuildingDialog from "../components/AddBuildingDialog.tsx";

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
  const ownedBuildings = buildings.filter((b) => !b.isShared);
  const buildingPaging = usePaging(ownedBuildings);
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;
  const t = useT();

  const [addOpen, setAddOpen] = useState(false);
  const [importMode, setImportMode] = useState(false);

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
    const { message } = await buildBuildingDeletionPreview(session, building);
    if (!await confirm({ title: "Delete building", message, confirmLabel: "Delete" })) {
      return;
    }
    deleteBuilding.mutate(building, {
      onSuccess: () => showNotification(msg("buildingDeleted"), "success"),
    });
  };

  const handleRevoke = async (buildingUri: string, webId: string) => {
    if (
      !await confirm({
        title: "Revoke access",
        message: `Revoke access for ${webId}?`,
        confirmLabel: "Revoke",
      })
    ) return;
    revoke.mutate({ buildingUri, webId }, {
      onSuccess: () => showNotification(msg("accessRevoked"), "success"),
    });
  };

  const handleDownloadAll = async () => {
    if (ownedBuildings.length === 0) return;
    try {
      const enriched = await attachAnnualData(ownedBuildings, session);
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
      <Box sx={{ display: "flex", justifyContent: "center", p: 1, flexShrink: 0 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={buildingsView}
          onChange={(_e, next) => {
            if (next) setBuildingsView(next); // ignore deselect of the active button
          }}
          aria-label="Buildings view"
        >
          <ToggleButton value="map">Map</ToggleButton>
          <ToggleButton value="list">List</ToggleButton>
        </ToggleButtonGroup>
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
            <Typography variant="h6" sx={{ mb: 1 }}>Your buildings</Typography>
            {rdf && <RdfSourceLink href={rdf.buildings} />}
            <Stack
              direction="row"
              spacing={1.5}
              sx={{ flexWrap: "wrap", alignItems: "center", mb: 1 }}
            >
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => {
                  setImportMode(false);
                  setAddOpen(true);
                }}
              >
                Add Building
              </Button>
              <Button
                variant="outlined"
                startIcon={<UploadFileIcon />}
                onClick={() => {
                  setImportMode(true);
                  setAddOpen(true);
                }}
              >
                Autofill from file
              </Button>
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={handleDownloadAll}
                disabled={ownedBuildings.length === 0}
              >
                Download all (Excel)
              </Button>
            </Stack>

            {buildingsLoading
              ? <Typography variant="body2">Loading…</Typography>
              : ownedBuildings.length === 0
              ? (
                <Typography variant="body2">
                  {t("buildingsEmpty")}
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
                            <RdfSourceLink href={b.uri as string} inline />
                          </>
                        }
                        actions={
                          // A finder row carries at most one (destructive) action;
                          // Edit / Files / energy / Share / Download all live on the
                          // building page (/building/:id) now.
                          <RowAction
                            label="Delete building"
                            color="error"
                            icon={<DeleteIcon fontSize="small" />}
                            onClick={() => handleDelete(b)}
                          />
                        }
                      >
                        {sharedQuery.isLoading
                          ? (
                            <Typography variant="caption" color="text.secondary">
                              Shared with: Loading…
                            </Typography>
                          )
                          : (
                            <NestedAgentList
                              agents={sharedWith}
                              label="Shared with:"
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
        open={addOpen}
        autostartImport={importMode}
        onClose={() => setAddOpen(false)}
      />
    </Box>
  );
}

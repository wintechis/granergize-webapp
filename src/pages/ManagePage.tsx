import { buildingDisplayName } from "../lib/buildingDisplay.ts";
import {
  buildingFileUri,
  buildingIdStem,
} from "../services/rdf/building/buildingId.ts";
import { useMemo, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AddchartIcon from "@mui/icons-material/Addchart";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ShareIcon from "@mui/icons-material/Share";
import RefreshIcon from "@mui/icons-material/Refresh";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useNavigate } from "react-router-dom";
import { Session } from "@inrupt/solid-client-authn-browser";
import type {
  AggregatedViewDefinition,
  BuildingType,
} from "../types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useConfirm } from "../context/ConfirmContext.tsx";
import {
  useSharedBuildings,
  useSharedViews,
  useSolidData,
  useViewDefinitions,
} from "../hooks/queries.ts";
import {
  useDeleteBuilding,
  useDeleteView,
  useRefreshView,
  useRevokeBuildingAccess,
  useRevokeViewAccess,
} from "../hooks/mutations.ts";
import { getSnapshotUri } from "../services/aggregation/viewManager.ts";
import { attachAnnualData } from "../services/rdf/building/buildingSerializer.ts";
import {
  buildingsToXlsx,
  buildingToXlsx,
} from "../services/rdf/buildingWorkbook.ts";
import type { SpreadsheetFormat } from "../services/rdf/buildingTemplates.ts";
import { buildBuildingDeletionPreview } from "../services/buildingActions.ts";
import { tryPodResources } from "../services/pod/solidUtils.ts";
import { formatError } from "../lib/formatError.ts";
import { formatDate } from "../lib/formatDate.ts";
import { downloadXlsx } from "../lib/download.ts";
import { RdfSourceLink, UriLink } from "../components/detail/DetailView.tsx";
import { useDevMode } from "../hooks/devMode.ts";
import ResourceRow from "../components/ResourceRow.tsx";
import Pager from "../components/Pager.tsx";
import NestedAgentList from "../components/NestedAgentList.tsx";
import { usePaging } from "../hooks/usePaging.ts";
import {
  FilesDialog,
  ShareBuildingDialog,
} from "../components/BuildingDialogs.tsx";
import EnergyYearDialog from "../components/EnergyYearDialog.tsx";
import EditBuildingDialog from "../components/EditBuildingDialog.tsx";
import AddBuildingDialog from "../components/AddBuildingDialog.tsx";
import ShareViewDialog from "../components/ShareViewDialog.tsx";
import CreateViewDialog from "../components/CreateViewDialog.tsx";

interface ManagePageProps {
  session: Session;
}

/** Number of files attached to a building (drives the Files tooltip). */
const attachmentCount = (b: BuildingType): number =>
  Array.isArray(b.attachments) ? b.attachments.length : 0;

/**
 * The MANAGE tab: manage everything you own. Buildings — view their RDF, see who
 * they're shared with (and revoke), edit / share / delete each — and aggregated
 * views you build from your (and shared-in) data: create / share / revoke /
 * refresh / delete. This is the single home for outgoing data: the map's detail
 * pane is view-only, and SHARE shows only what others shared with you.
 */
export default function ManagePage({ session }: ManagePageProps) {
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();
  const { buildings, isLoading: buildingsLoading } = useSolidData();
  const navigate = useNavigate();
  const ownedBuildings = buildings.filter((b) => !b.isShared);
  const buildingPaging = usePaging(ownedBuildings);
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;
  const dev = useDevMode();

  const [addOpen, setAddOpen] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [editBuilding, setEditBuilding] = useState<BuildingType | null>(null);
  const [filesBuilding, setFilesBuilding] = useState<BuildingType | null>(null);
  const [energyYearBuilding, setEnergyYearBuilding] = useState<
    BuildingType | null
  >(null);
  const [shareBuilding, setShareBuilding] = useState<BuildingType | null>(null);
  // Re-read a dialog's building from the LIVE query rather than the frozen
  // object captured at click time: data added just before opening the dialog —
  // notably a freshly-added energy year, which drives the per-year share picker
  // and the energy dialog's stored-years table — lands via a buildings refetch,
  // and the dialog must reflect it without a reopen.
  const liveBuilding = (b: BuildingType | null) =>
    b ? buildings.find((x) => x.uri === b.uri) ?? b : null;
  const liveShareBuilding = liveBuilding(shareBuilding);
  const liveEnergyYearBuilding = liveBuilding(energyYearBuilding);
  const [createViewOpen, setCreateViewOpen] = useState(false);
  const [viewToShare, setViewToShare] = useState<
    AggregatedViewDefinition | null
  >(null);

  // buildingUri → WebIDs it is shared with.
  const sharedQuery = useSharedBuildings();
  const recipients = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const s of sharedQuery.data ?? []) map[s.buildingUri] = s.sharedWith;
    return map;
  }, [sharedQuery.data]);

  const viewDefsQuery = useViewDefinitions();
  const viewDefinitions = viewDefsQuery.data ?? [];
  const viewPaging = usePaging(viewDefinitions);
  const sharedViewsQuery = useSharedViews();
  const sharedViews = sharedViewsQuery.data ?? [];

  const deleteBuilding = useDeleteBuilding();
  const revoke = useRevokeBuildingAccess();
  const refreshView = useRefreshView();
  const deleteViewMut = useDeleteView();
  const revokeView = useRevokeViewAccess();

  const handleDelete = async (building: BuildingType) => {
    // Build the "what will be removed" preview, confirm, then delete (the
    // confirm lives here, not in the service — same pattern as handleRevoke).
    const { message } = await buildBuildingDeletionPreview(session, building);
    if (!await confirm({ title: "Delete building", message, confirmLabel: "Delete" })) {
      return;
    }
    deleteBuilding.mutate(building, {
      onSuccess: () => showNotification("Building deleted", "success"),
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
      onSuccess: () => showNotification("Access revoked", "success"),
    });
  };

  // Per-building Excel export, in a user-chosen layout (a building no longer carries
  // a role, so the spreadsheet shape is picked here). Anchored to the row's button.
  const [exportMenu, setExportMenu] = useState<
    { anchor: HTMLElement; building: BuildingType } | null
  >(null);

  const handleDownload = async (building: BuildingType, style: SpreadsheetFormat) => {
    setExportMenu(null);
    try {
      // Energy is no longer inline; fetch the annual datasets for the export.
      const [enriched] = await attachAnnualData([building], session);
      // The id is an IRI reference ("/" and "#" — browsers mangle both in
      // filenames); the stem is the filename-safe display form.
      downloadXlsx(
        await buildingToXlsx(enriched, style),
        `building-${buildingIdStem(building.id)}.xlsx`,
      );
    } catch (error) {
      showNotification(formatError("export the building", error), "error");
    }
  };

  // The export-layout options, labelled by spreadsheet shape (not a role).
  const EXPORT_STYLES: { style: SpreadsheetFormat; label: string }[] = [
    { style: "generic", label: "Generic (field-name columns)" },
    { style: "investor", label: "Row-label sheet (one column per building)" },
    { style: "benchmark", label: "Table (one row per building)" },
  ];

  const handleDownloadAll = async () => {
    if (ownedBuildings.length === 0) return;
    try {
      const enriched = await attachAnnualData(ownedBuildings, session);
      downloadXlsx(await buildingsToXlsx(enriched), "buildings-mine.xlsx");
    } catch (error) {
      showNotification(formatError("export the buildings", error), "error");
    }
  };

  const handleRefreshView = (viewId: string) =>
    refreshView.mutate(viewId, {
      onSuccess: () => showNotification("View snapshot refreshed", "success"),
    });

  const handleDeleteView = async (viewId: string) => {
    if (
      !await confirm({
        title: "Delete view",
        message:
          "Delete this view? This also revokes access for everyone it is shared with.",
        confirmLabel: "Delete",
      })
    ) {
      return;
    }
    deleteViewMut.mutate(viewId, {
      onSuccess: () => showNotification("View deleted", "success"),
    });
  };

  const handleRevokeViewAccess = async (snapshotUri: string, webId: string) => {
    if (
      !await confirm({
        title: "Revoke view access",
        message: `Revoke view access for ${webId}?`,
        confirmLabel: "Revoke",
      })
    ) return;
    revokeView.mutate({ snapshotUri, webId }, {
      onSuccess: () => showNotification("View access revoked", "success"),
    });
  };

  const getViewSharedWith = (viewId: string): string[] => {
    const webId = session.info.webId;
    if (!webId) return [];
    const snapshotUri = getSnapshotUri(webId, viewId);
    const shared = sharedViews.find((sv) => sv.snapshotUri === snapshotUri);
    return shared?.sharedWith || [];
  };

  return (
    <Box component="section" sx={{ p: 3 }}>
      <section>
        <Typography variant="h6" sx={{ mb: 1 }}>Your buildings</Typography>
        {rdf && <RdfSourceLink href={rdf.buildings} />}
        <Stack
          direction="row"
          spacing={1.5}
          flexWrap="wrap"
          useFlexGap
          sx={{ alignItems: "center", mb: 1 }}
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
              No buildings yet. Add one, or autofill it from a file.
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
                        <strong>{name}</strong>
                        {b.streetAddress && b.streetAddress !== name
                          ? ` — ${b.streetAddress}`
                          : ""}
                        {dev && (
                          <Box
                            component="span"
                            sx={{ display: "block", wordBreak: "break-all" }}
                          >
                            <UriLink href={b.uri as string}>{b.uri}</UriLink>
                          </Box>
                        )}
                      </>
                    }
                    actions={
                      <>
                        <Tooltip title="Edit building">
                          <IconButton
                            size="small"
                            aria-label="Edit building"
                            onClick={() => setEditBuilding(b)}
                          >
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip
                          title={attachmentCount(b) > 0
                            ? `Files (${attachmentCount(b)})`
                            : "Files"}
                        >
                          <IconButton
                            size="small"
                            aria-label="Manage files"
                            onClick={() => setFilesBuilding(b)}
                          >
                            <AttachFileIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Add / edit energy year">
                          <IconButton
                            size="small"
                            aria-label="Add or edit energy year"
                            onClick={() => setEnergyYearBuilding(b)}
                          >
                            <AddchartIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Share building data">
                          <IconButton
                            size="small"
                            aria-label="Share building data"
                            onClick={() => setShareBuilding(b)}
                          >
                            <ShareIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Download this building's data (Excel)">
                          <IconButton
                            size="small"
                            aria-label="Download building data"
                            onClick={(e) =>
                              setExportMenu({ anchor: e.currentTarget, building: b })}
                          >
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete building">
                          <IconButton
                            size="small"
                            color="error"
                            aria-label="Delete building"
                            onClick={() => handleDelete(b)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </>
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
        <Menu
          anchorEl={exportMenu?.anchor ?? null}
          open={exportMenu != null}
          onClose={() => setExportMenu(null)}
        >
          {EXPORT_STYLES.map(({ style, label }) => (
            <MenuItem
              key={style}
              onClick={() =>
                exportMenu && handleDownload(exportMenu.building, style)}
            >
              {label}
            </MenuItem>
          ))}
        </Menu>
      </section>

      <section>
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          Aggregated views
        </Typography>
        {rdf && <RdfSourceLink href={rdf.views} />}
        <Stack
          direction="row"
          spacing={1.5}
          flexWrap="wrap"
          useFlexGap
          sx={{ alignItems: "center", mb: 1 }}
        >
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => setCreateViewOpen(true)}
          >
            Create View
          </Button>
        </Stack>
        {viewDefsQuery.isLoading
          ? <Typography variant="body2">Loading…</Typography>
          : viewDefinitions.length === 0
          ? (
            <Typography variant="body2">
              No aggregated views yet. Create one to aggregate energy values
              across buildings.
            </Typography>
          )
          : (
            <Box component="ul" sx={{ listStyle: "none", pl: 0, m: 0 }}>
              {viewPaging.pageItems.map((view) => {
                const sharedWith = getViewSharedWith(view.id);
                return (
                  <ResourceRow
                    key={view.id}
                    title={<strong>{view.name}</strong>}
                    subtitle={
                      <>
                        Type: {view.aggregationType} | Buildings:{" "}
                        {view.buildingUris.length} | Metrics:{" "}
                        {view.metrics.length}
                        <br />
                        Created: {formatDate(view.createdAt)}
                        {view.lastComputedAt &&
                          ` | Last computed: ${formatDate(view.lastComputedAt)}`}
                      </>
                    }
                    actions={
                      <>
                        <Tooltip title="View details">
                          <IconButton
                            size="small"
                            aria-label="View details"
                            onClick={() =>
                              navigate(`/view/${encodeURIComponent(view.id)}`)}
                          >
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Refresh snapshot">
                          <span>
                            <IconButton
                              size="small"
                              aria-label="Refresh snapshot"
                              onClick={() => handleRefreshView(view.id)}
                              disabled={refreshView.isPending &&
                                refreshView.variables === view.id}
                            >
                              <RefreshIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Share view">
                          <IconButton
                            size="small"
                            aria-label="Share view"
                            onClick={() => setViewToShare(view)}
                          >
                            <ShareIcon />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete view">
                          <span>
                            <IconButton
                              size="small"
                              aria-label="Delete view"
                              onClick={() => handleDeleteView(view.id)}
                              disabled={deleteViewMut.isPending &&
                                deleteViewMut.variables === view.id}
                            >
                              <DeleteIcon />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </>
                    }
                  >
                    {sharedViewsQuery.isLoading
                      ? (
                        <Typography variant="caption" color="text.secondary">
                          Shared with: Loading…
                        </Typography>
                      )
                      : (
                        <NestedAgentList
                          agents={sharedWith}
                          label="Shared with:"
                          onRevoke={(webId) =>
                            handleRevokeViewAccess(
                              getSnapshotUri(session.info.webId!, view.id),
                              webId,
                            )}
                          isRevoking={(webId) =>
                            revokeView.isPending &&
                            revokeView.variables?.snapshotUri ===
                              getSnapshotUri(session.info.webId!, view.id) &&
                            revokeView.variables?.webId === webId}
                        />
                      )}
                  </ResourceRow>
                );
              })}
            </Box>
          )}
        <Pager paging={viewPaging} />
      </section>

      {/* Outgoing-share log — the append-only record of buildings and views you've
          shared out (and revoked). It backs the "Shared with" badges above; the
          symmetric incoming side (shared-in/ + inbox) lives on the Share tab.
          Developer-mode only: this exposes the raw log container. */}
      {dev && rdf && (
        <section>
          <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
            Outgoing shares
          </Typography>
          <RdfSourceLink href={rdf.sharedOut} />
        </section>
      )}

      {editBuilding && (
        <EditBuildingDialog
          key={editBuilding.uri as string}
          open
          building={editBuilding}
          onClose={() => setEditBuilding(null)}
        />
      )}
      {filesBuilding && (
        <FilesDialog
          open
          building={filesBuilding}
          session={session}
          onClose={() => setFilesBuilding(null)}
        />
      )}
      {energyYearBuilding && (
        <EnergyYearDialog
          open
          building={liveEnergyYearBuilding ?? energyYearBuilding}
          session={session}
          onClose={() => setEnergyYearBuilding(null)}
        />
      )}
      {shareBuilding && (
        <ShareBuildingDialog
          open
          buildingUri={(shareBuilding.sourceUri ?? shareBuilding.uri) as string}
          building={liveShareBuilding ?? shareBuilding}
          session={session}
          onClose={() => setShareBuilding(null)}
        />
      )}
      <AddBuildingDialog
        open={addOpen}
        autostartImport={importMode}
        onClose={() => setAddOpen(false)}
      />
      {viewToShare && (
        <ShareViewDialog
          view={viewToShare}
          open
          onClose={() => setViewToShare(null)}
          session={session}
        />
      )}
      <CreateViewDialog
        open={createViewOpen}
        buildings={buildings}
        onClose={() => setCreateViewOpen(false)}
      />
    </Box>
  );
}

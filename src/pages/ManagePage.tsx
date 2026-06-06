import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, IconButton, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AddchartIcon from "@mui/icons-material/Addchart";
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
} from "../../types/types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import {
  queryKeys,
  useSharedBuildings,
  useSharedViews,
  useSolidData,
  useViewDefinitions,
} from "../hooks/queries.ts";
import {
  useDeleteBuilding,
  useDeleteView,
  useInvalidateBuildingData,
  useRefreshView,
  useRevokeBuildingAccess,
  useRevokeViewAccess,
} from "../hooks/mutations.ts";
import { getSnapshotUrl } from "../services/aggregation/viewManager.ts";
import {
  attachAnnualData,
  buildingsToXlsx,
  buildingToXlsx,
} from "../services/utils/buildingSerializer.ts";
import { buildBuildingDeletionPreview } from "../services/utils/buildingActions.ts";
import { tryPodResources } from "../services/utils/solidUtils.ts";
import { formatError } from "../services/utils/formatError.ts";
import { downloadXlsx } from "../services/utils/download.ts";
import { RdfSourceLink, UriLink } from "../components/detail/DetailView.tsx";
import { useDevMode } from "../components/devMode.ts";
import {
  ellipsis,
  listStyle,
  nestedListStyle,
  rowStyle,
} from "../components/listStyles.ts";
import Pager from "../components/Pager.tsx";
import { usePaging } from "../components/usePaging.ts";
import {
  EnergyCertificateDialog,
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

/** Whether a building already carries an energy certificate (drives the tooltip). */
const hasEnergyCertificate = (b: BuildingType): boolean =>
  typeof b.energyCertificate === "string" &&
  b.energyCertificate.trim().length > 0;

/**
 * The MANAGE tab: manage everything you own. Buildings — view their RDF, see who
 * they're shared with (and revoke), edit / share / delete each — and aggregated
 * views you build from your (and shared-in) data: create / share / revoke /
 * refresh / delete. This is the single home for outgoing data: the map's detail
 * pane is view-only, and SHARE shows only what others shared with you.
 */
export default function ManagePage({ session }: ManagePageProps) {
  const { showNotification } = useNotification();
  const { buildings, isLoading: buildingsLoading } = useSolidData();
  const reloadData = useInvalidateBuildingData();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ownedBuildings = buildings.filter((b) => !b.isShared);
  const buildingPaging = usePaging(ownedBuildings);
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;
  const dev = useDevMode();

  const [addOpen, setAddOpen] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [editBuilding, setEditBuilding] = useState<BuildingType | null>(null);
  const [certBuilding, setCertBuilding] = useState<BuildingType | null>(null);
  const [energyYearBuilding, setEnergyYearBuilding] = useState<
    BuildingType | null
  >(null);
  const [shareBuilding, setShareBuilding] = useState<BuildingType | null>(null);
  const [createViewOpen, setCreateViewOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
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
    if (!globalThis.confirm(message)) return;
    deleteBuilding.mutate(building, {
      onSuccess: () => showNotification("Building deleted", "success"),
    });
  };

  const handleRevoke = (buildingUri: string, webId: string) => {
    if (!globalThis.confirm(`Revoke access for ${webId}?`)) return;
    revoke.mutate({ buildingUri, webId }, {
      onSuccess: () => showNotification("Access revoked", "success"),
    });
  };

  const handleDownload = async (building: BuildingType) => {
    try {
      // Energy is no longer inline; fetch the annual datasets for the export.
      const [enriched] = await attachAnnualData([building], session);
      downloadXlsx(buildingToXlsx(enriched), `building-${building.id}.xlsx`);
    } catch (error) {
      showNotification(formatError("export the building", error), "error");
    }
  };

  const handleDownloadAll = async () => {
    if (ownedBuildings.length === 0) return;
    try {
      const enriched = await attachAnnualData(ownedBuildings, session);
      downloadXlsx(buildingsToXlsx(enriched), "buildings-mine.xlsx");
    } catch (error) {
      showNotification(formatError("export the buildings", error), "error");
    }
  };

  const handleRefreshView = (viewId: string) =>
    refreshView.mutate(viewId, {
      onSuccess: () => showNotification("View snapshot refreshed", "success"),
    });

  const handleDeleteView = (viewId: string) => {
    if (
      !confirm(
        "Are you sure you want to delete this view? This will also revoke access for all shared users.",
      )
    ) {
      return;
    }
    deleteViewMut.mutate(viewId, {
      onSuccess: () => showNotification("View deleted", "success"),
    });
  };

  const handleOpenShareDialog = (view: AggregatedViewDefinition) => {
    setViewToShare(view);
    setShareDialogOpen(true);
  };

  const handleCloseShareDialog = () => {
    setShareDialogOpen(false);
    setViewToShare(null);
    queryClient.invalidateQueries({ queryKey: queryKeys.viewDefinitions });
    queryClient.invalidateQueries({ queryKey: queryKeys.sharedViews });
  };

  const handleRevokeViewAccess = (snapshotUrl: string, webId: string) => {
    if (!confirm(`Revoke view access for ${webId}?`)) return;
    revokeView.mutate({ snapshotUrl, webId }, {
      onSuccess: () => showNotification("View access revoked", "success"),
    });
  };

  const getViewSharedWith = (viewId: string): string[] => {
    const webId = session.info.webId;
    if (!webId) return [];
    const snapshotUrl = getSnapshotUrl(webId, viewId);
    const shared = sharedViews.find((sv) => sv.snapshotUrl === snapshotUrl);
    return shared?.sharedWith || [];
  };

  return (
    <section style={{ padding: "1.5rem" }}>
      <section>
        <Typography variant="h6" sx={{ mb: 1 }}>Your buildings</Typography>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
            marginBottom: "0.5rem",
          }}
        >
          {rdf && <RdfSourceLink href={rdf.buildings} />}
          <Button
            size="small"
            variant="outlined"
            startIcon={<DownloadIcon />}
            onClick={handleDownloadAll}
            disabled={ownedBuildings.length === 0}
          >
            Download all (Excel)
          </Button>
        </div>

        {buildingsLoading
          ? <p>Loading…</p>
          : ownedBuildings.length === 0
          ? <p>You haven't added any buildings yet.</p>
          : (
            <ul style={listStyle}>
              {buildingPaging.pageItems.map((b) => {
                const fileUri = (b.sourceUri ?? b.uri).split("#")[0];
                const sharedWith = recipients[fileUri] ?? recipients[b.uri] ??
                  [];
                return (
                  <li key={b.uri} style={{ marginBottom: "1rem" }}>
                    <div style={{ ...rowStyle, alignItems: "flex-start" }}>
                      <div style={{ minWidth: 0 }}>
                        <strong>Building {b.id}</strong>
                        {b.streetAddress ? ` — ${b.streetAddress}` : ""}
                        {dev && (
                          <>
                            <br />
                            <span style={{ wordBreak: "break-all" }}>
                              <UriLink href={b.uri as string}>{b.uri}</UriLink>
                            </span>
                          </>
                        )}
                        {sharedQuery.isLoading
                          ? (
                            <>
                              <br />
                              <small>Shared with: Loading…</small>
                            </>
                          )
                          : sharedWith.length > 0 && (
                          <>
                            <br />
                            <small>Shared with:</small>
                            <ul style={nestedListStyle}>
                              {sharedWith.map((webId) => (
                                <li key={webId} style={rowStyle}>
                                  <span title={webId} style={ellipsis}>
                                    {webId}
                                  </span>
                                  <IconButton
                                    size="small"
                                    title="Revoke access"
                                    aria-label="Revoke access"
                                    onClick={() => handleRevoke(fileUri, webId)}
                                    disabled={revoke.isPending &&
                                      revoke.variables?.buildingUri ===
                                        fileUri &&
                                      revoke.variables?.webId === webId}
                                  >
                                    <DeleteIcon fontSize="small" />
                                  </IconButton>
                                </li>
                              ))}
                            </ul>
                          </>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "0.25rem" }}>
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
                          title={hasEnergyCertificate(b)
                            ? "Replace energy certificate"
                            : "Upload energy certificate"}
                        >
                          <IconButton
                            size="small"
                            aria-label="Upload energy certificate"
                            onClick={() => setCertBuilding(b)}
                          >
                            <UploadFileIcon fontSize="small" />
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
                            onClick={() => handleDownload(b)}
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
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        <Pager paging={buildingPaging} />

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
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
        </div>
      </section>

      <section>
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          Aggregated views
        </Typography>
        {rdf && <RdfSourceLink href={rdf.views} />}
        {viewDefsQuery.isLoading
          ? <p>Loading…</p>
          : viewDefinitions.length === 0
          ? <p>No aggregated views yet.</p>
          : (
            <ul style={listStyle}>
              {viewPaging.pageItems.map((view) => {
                const sharedWith = getViewSharedWith(view.id);
                return (
                  <li key={view.id}>
                    <div style={{ ...rowStyle, alignItems: "flex-start" }}>
                      <div>
                        <strong>{view.name}</strong>
                        <br />
                        <small>
                          Type: {view.aggregationType} | Buildings:{" "}
                          {view.buildingUris.length} | Metrics:{" "}
                          {view.metrics.length}
                        </small>
                        <br />
                        <small>
                          Created:{" "}
                          {new Date(view.createdAt).toLocaleDateString()}
                          {view.lastComputedAt &&
                            ` | Last computed: ${
                              new Date(view.lastComputedAt).toLocaleDateString()
                            }`}
                        </small>
                        {sharedViewsQuery.isLoading
                          ? (
                            <>
                              <br />
                              <small>Shared with: Loading…</small>
                            </>
                          )
                          : sharedWith.length > 0 && (
                          <ul style={nestedListStyle}>
                            {sharedWith.map((webId) => (
                              <li key={webId} style={rowStyle}>
                                <Typography
                                  component="span"
                                  variant="caption"
                                  title={webId}
                                  sx={ellipsis}
                                >
                                  {webId}
                                </Typography>
                                <IconButton
                                  size="small"
                                  onClick={() =>
                                    handleRevokeViewAccess(
                                      getSnapshotUrl(
                                        session.info.webId!,
                                        view.id,
                                      ),
                                      webId,
                                    )}
                                  title="Revoke access"
                                  aria-label="Revoke access"
                                  disabled={revokeView.isPending &&
                                    revokeView.variables?.snapshotUrl ===
                                      getSnapshotUrl(
                                        session.info.webId!,
                                        view.id,
                                      ) &&
                                    revokeView.variables?.webId === webId}
                                >
                                  <DeleteIcon fontSize="small" />
                                </IconButton>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: "0.25rem" }}>
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
                            onClick={() => handleOpenShareDialog(view)}
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
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        <Pager paging={viewPaging} />
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setCreateViewOpen(true)}
        >
          Create View
        </Button>
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
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            The append-only log of buildings and views you've shared with others.
            It records the "Shared with" history above. Open it to browse the raw
            RDF.
          </Typography>
          <RdfSourceLink href={rdf.sharedOut} />
        </section>
      )}

      {editBuilding && (
        <EditBuildingDialog
          key={editBuilding.uri as string}
          open
          building={editBuilding}
          session={session}
          onClose={() => setEditBuilding(null)}
          onBuildingUpdated={reloadData}
        />
      )}
      {certBuilding && (
        <EnergyCertificateDialog
          open
          buildingUri={certBuilding.uri as string}
          session={session}
          onClose={() => setCertBuilding(null)}
          onUploadSuccess={reloadData}
        />
      )}
      {energyYearBuilding && (
        <EnergyYearDialog
          open
          building={energyYearBuilding}
          session={session}
          onClose={() => setEnergyYearBuilding(null)}
        />
      )}
      {shareBuilding && (
        <ShareBuildingDialog
          open
          buildingUri={(shareBuilding.sourceUri ?? shareBuilding.uri) as string}
          building={shareBuilding}
          session={session}
          onClose={() => {
            setShareBuilding(null);
            queryClient.invalidateQueries({
              queryKey: queryKeys.sharedBuildings,
            });
          }}
        />
      )}
      <AddBuildingDialog
        open={addOpen}
        session={session}
        autostartImport={importMode}
        onClose={() => setAddOpen(false)}
        onBuildingAdded={() => {
          setAddOpen(false);
          reloadData();
        }}
      />
      {viewToShare && (
        <ShareViewDialog
          view={viewToShare}
          open={shareDialogOpen}
          onClose={handleCloseShareDialog}
          session={session}
        />
      )}
      <CreateViewDialog
        open={createViewOpen}
        buildings={buildings}
        session={session}
        onClose={() => setCreateViewOpen(false)}
        onViewCreated={() =>
          queryClient.invalidateQueries({ queryKey: queryKeys.viewDefinitions })}
      />
    </section>
  );
}

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, IconButton, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
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
import { tryPodResources } from "../services/utils/solidUtils.ts";
import { RdfSourceLink, UriLink } from "../components/detail/DetailView.tsx";
import {
  ellipsis,
  listStyle,
  nestedListStyle,
  rowStyle,
} from "../components/listStyles.ts";
import Pager from "../components/Pager.tsx";
import { usePaging } from "../components/usePaging.ts";
import { ShareBuildingDialog } from "../components/BuildingDialogs.tsx";
import EditBuildingDialog from "../components/EditBuildingDialog.tsx";
import AddBuildingDialog from "../components/AddBuildingDialog.tsx";
import ShareViewDialog from "../components/ShareViewDialog.tsx";
import CreateViewDialog from "../components/CreateViewDialog.tsx";

interface ManagePageProps {
  session: Session;
}

/**
 * The MANAGE tab: manage everything you own. Buildings — view their RDF, see who
 * they're shared with (and revoke), edit / share / delete each — and aggregated
 * views you build from your (and shared-in) data: create / share / revoke /
 * refresh / delete. This is the single home for outgoing data: the map's detail
 * pane is view-only, and SHARE shows only what others shared with you.
 */
export default function ManagePage({ session }: ManagePageProps) {
  const { showNotification } = useNotification();
  const { buildings } = useSolidData();
  const reloadData = useInvalidateBuildingData();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const ownedBuildings = buildings.filter((b) => !b.isShared);
  const buildingPaging = usePaging(ownedBuildings);
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;

  const [addOpen, setAddOpen] = useState(false);
  const [importMode, setImportMode] = useState(false);
  const [editBuilding, setEditBuilding] = useState<BuildingType | null>(null);
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

  const viewDefinitions = useViewDefinitions().data ?? [];
  const viewPaging = usePaging(viewDefinitions);
  const sharedViews = useSharedViews().data ?? [];

  const deleteBuilding = useDeleteBuilding();
  const revoke = useRevokeBuildingAccess();
  const refreshView = useRefreshView();
  const deleteViewMut = useDeleteView();
  const revokeView = useRevokeViewAccess();

  const handleDelete = (building: BuildingType) => {
    deleteBuilding.mutate(building, {
      onSuccess: (deleted) => {
        if (deleted) showNotification("Building deleted", "success");
      },
    });
  };

  const handleRevoke = (buildingUri: string, webId: string) => {
    if (!globalThis.confirm(`Revoke access for ${webId}?`)) return;
    revoke.mutate({ buildingUri, webId }, {
      onSuccess: () => showNotification("Access revoked", "success"),
    });
  };

  const handleDownload = async (fileUrl: string, id: string | number) => {
    try {
      const res = await session.fetch(fileUrl, {
        headers: { Accept: "text/turtle" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(
        new Blob([await res.text()], { type: "text/turtle" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `building-${id}.ttl`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showNotification(
        `Failed to download building data: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
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
        {rdf && <RdfSourceLink href={rdf.buildings} />}

        {ownedBuildings.length === 0
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
                        <br />
                        <span style={{ wordBreak: "break-all" }}>
                          <UriLink href={b.uri as string}>{b.uri}</UriLink>
                        </span>
                        {sharedWith.length > 0 && (
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
                        <Tooltip title="Share building data">
                          <IconButton
                            size="small"
                            aria-label="Share building data"
                            onClick={() => setShareBuilding(b)}
                          >
                            <ShareIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Download this building's data (Turtle)">
                          <IconButton
                            size="small"
                            aria-label="Download building data"
                            onClick={() => handleDownload(fileUri, b.id)}
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
        {rdf && <RdfSourceLink href={rdf.viewDefinitions} />}
        {viewDefinitions.length === 0
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
                        {sharedWith.length > 0 && (
                          <ul style={nestedListStyle}>
                            {sharedWith.map((webId) => (
                              <li key={webId} style={rowStyle}>
                                <span
                                  title={webId}
                                  // eslint-disable-next-line no-restricted-syntax -- plain-HTML span at caption-tier size (0.8rem); intentionally not MUI Typography
                                  style={{ ...ellipsis, fontSize: "0.8rem" }}
                                >
                                  {webId}
                                </span>
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
                        <IconButton
                          size="small"
                          onClick={() =>
                            navigate(`/view/${encodeURIComponent(view.id)}`)}
                          title="View details"
                        >
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => handleRefreshView(view.id)}
                          title="Refresh snapshot"
                          disabled={refreshView.isPending &&
                            refreshView.variables === view.id}
                        >
                          <RefreshIcon />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => handleOpenShareDialog(view)}
                          title="Share view"
                        >
                          <ShareIcon />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => handleDeleteView(view.id)}
                          title="Delete view"
                          disabled={deleteViewMut.isPending &&
                            deleteViewMut.variables === view.id}
                        >
                          <DeleteIcon />
                        </IconButton>
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
      {shareBuilding && (
        <ShareBuildingDialog
          open
          buildingUri={(shareBuilding.sourceUri ?? shareBuilding.uri) as string}
          session={session}
          role={shareBuilding.sourceRole}
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

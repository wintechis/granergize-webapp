import { useEffect, useState } from "react";
import {
  Button,
  CircularProgress,
  IconButton,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import RefreshIcon from "@mui/icons-material/Refresh";
import ShareIcon from "@mui/icons-material/Share";
import { useNavigate } from "react-router-dom";
import { Session } from "@inrupt/solid-client-authn-browser";
import {
  getSharedBuildings,
  getSharedViews,
  getSharedWithMe,
  revokeAccess,
  revokeViewAccess,
  toggleBuildingVisibility,
} from "../services/interop/sharingManager.ts";
import {
  deleteView,
  getSnapshotUrl,
  getViewDefinitions,
} from "../services/aggregation/viewManager.ts";
import { refreshSnapshot } from "../services/aggregation/viewComputer.ts";
import type { AggregatedViewDefinition } from "../../types/types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useSolidData } from "../context/SolidDataContext.tsx";
import { podResources } from "../services/utils/solidUtils.ts";
import { RdfSourceLink } from "./detail/DetailView.tsx";
import ShareViewDialog from "./ShareViewDialog.tsx";
import CreateViewDialog from "./CreateViewDialog.tsx";
import AddBuildingDialog from "./AddBuildingDialog.tsx";

interface SharingPageProps {
  session: Session;
}

interface SharedBuilding {
  buildingUri: string;
  buildingId: string;
  sharedWith: string[];
}

interface SharedWithMeBuilding {
  buildingUri: string;
  buildingId: string;
  sharedBy: string;
  isVisible: boolean;
  sharedRole?: string;
}

interface SharedView {
  snapshotUrl: string;
  viewId: string;
  sharedWith: string[];
}

const ROLE_LABELS: Record<string, string> = {
  dummy: "Dummy",
  investor: "Investor",
  user: "User",
  benchmark_service_provider: "Benchmark Service Provider",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.5rem",
};

const ellipsis: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

/** Bulletless, flush-left list — used for every list on the page. */
const listStyle: React.CSSProperties = {
  listStyle: "none",
  paddingLeft: 0,
  margin: 0,
};
/** Same, but indented — for lists nested inside a list item. */
const nestedListStyle: React.CSSProperties = {
  ...listStyle,
  paddingLeft: "1.25rem",
  marginTop: "0.25rem",
};

export default function SharingPage({ session }: SharingPageProps) {
  const { showNotification } = useNotification();
  const { buildings, reloadData } = useSolidData();
  const [addBuildingOpen, setAddBuildingOpen] = useState(false);
  // When true, the Add Building dialog opens straight into the file picker
  // (bulk "autofill from file") rather than the single-building manual form.
  const [importMode, setImportMode] = useState(false);
  // Buildings on your own Pod (not shared in from someone else).
  const ownedBuildings = buildings.filter((b) => !b.isShared);
  // Backing RDF resources, linked under each section so storage is inspectable.
  const rdf = session.info.webId ? podResources(session.info.webId) : null;
  const navigate = useNavigate();
  const [createViewOpen, setCreateViewOpen] = useState(false);
  const [sharedBuildings, setSharedBuildings] = useState<SharedBuilding[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SharedWithMeBuilding[]>([]);
  const [viewDefinitions, setViewDefinitions] = useState<
    AggregatedViewDefinition[]
  >([]);
  const [sharedViews, setSharedViews] = useState<SharedView[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshingViewId, setRefreshingViewId] = useState<string | null>(null);
  const [revokingBuildingKey, setRevokingBuildingKey] = useState<string | null>(
    null,
  );
  const [revokingViewKey, setRevokingViewKey] = useState<string | null>(null);
  const [deletingViewId, setDeletingViewId] = useState<string | null>(null);
  const [togglingVisibility, setTogglingVisibility] = useState<string | null>(
    null,
  );
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [viewToShare, setViewToShare] = useState<
    AggregatedViewDefinition | null
  >(null);

  useEffect(() => {
    loadSharedBuildings();
    loadViewData();
  }, [session]);

  const loadSharedBuildings = async () => {
    setLoading(true);
    try {
      const [outgoing, incoming] = await Promise.all([
        getSharedBuildings(session),
        getSharedWithMe(session),
      ]);
      setSharedBuildings(outgoing);
      setSharedWithMe(incoming);
    } catch (error) {
      console.error("Error loading shared buildings:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadViewData = async () => {
    try {
      const [views, shared] = await Promise.all([
        getViewDefinitions(session),
        getSharedViews(session),
      ]);
      setViewDefinitions(views);
      setSharedViews(shared);
    } catch (error) {
      console.error("Error loading view data:", error);
    }
  };

  const handleRevokeAccess = async (buildingUri: string, webId: string) => {
    if (!confirm(`Revoke access for ${webId}?`)) return;
    const key = `${buildingUri}__${webId}`;
    setRevokingBuildingKey(key);
    try {
      await revokeAccess(buildingUri, webId, session);
      await loadSharedBuildings();
      showNotification("Access revoked", "success");
    } catch (error) {
      console.error("Error revoking access:", error);
      showNotification(
        `Failed to revoke access: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
    } finally {
      setRevokingBuildingKey(null);
    }
  };

  // Export a building's actual data (its Turtle) — available for any building
  // the user can read (owned or shared in). `fileUrl` is the building's source
  // document; what it contains depends on the building's role.
  const handleDownloadBuilding = async (
    fileUrl: string,
    id: string | number,
  ) => {
    try {
      const res = await session.fetch(fileUrl, {
        headers: { Accept: "text/turtle" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/turtle" }),
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

  const handleToggleVisibility = async (buildingUri: string) => {
    setTogglingVisibility(buildingUri);
    try {
      await toggleBuildingVisibility(buildingUri, session);
      await loadSharedBuildings();
    } catch (error) {
      console.error("Error toggling visibility:", error);
      showNotification(
        `Failed to toggle visibility: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
    } finally {
      setTogglingVisibility(null);
    }
  };

  const handleRefreshView = async (viewId: string) => {
    setRefreshingViewId(viewId);
    try {
      await refreshSnapshot(session, viewId);
      await loadViewData();
      showNotification("View snapshot refreshed", "success");
    } catch (error) {
      console.error("Error refreshing view:", error);
      showNotification(
        `Failed to refresh view: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
    } finally {
      setRefreshingViewId(null);
    }
  };

  const handleDeleteView = async (viewId: string) => {
    if (
      !confirm(
        "Are you sure you want to delete this view? This will also revoke access for all shared users.",
      )
    ) {
      return;
    }
    setDeletingViewId(viewId);
    try {
      await deleteView(session, viewId);
      await loadViewData();
      showNotification("View deleted", "success");
    } catch (error) {
      console.error("Error deleting view:", error);
      showNotification(
        `Failed to delete view: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
    } finally {
      setDeletingViewId(null);
    }
  };

  const handleOpenShareDialog = (view: AggregatedViewDefinition) => {
    setViewToShare(view);
    setShareDialogOpen(true);
  };

  const handleCloseShareDialog = () => {
    setShareDialogOpen(false);
    setViewToShare(null);
    loadViewData();
  };

  const handleRevokeViewAccess = async (snapshotUrl: string, webId: string) => {
    if (!confirm(`Revoke view access for ${webId}?`)) return;
    const key = `${snapshotUrl}__${webId}`;
    setRevokingViewKey(key);
    try {
      await revokeViewAccess(snapshotUrl, webId, session);
      await loadViewData();
      showNotification("View access revoked", "success");
    } catch (error) {
      console.error("Error revoking view access:", error);
      showNotification(
        `Failed to revoke access: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
    } finally {
      setRevokingViewKey(null);
    }
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
        <Typography variant="h6" sx={{ mb: 1 }}>
          Your buildings
        </Typography>
        {rdf && <RdfSourceLink href={rdf.buildings} />}
        {ownedBuildings.length === 0
          ? <p>You haven't added any buildings yet.</p>
          : (
            <ul style={listStyle}>
              {ownedBuildings.map((b) => (
                <li key={b.uri} style={rowStyle}>
                  <span>Building {b.id}</span>
                  <Tooltip title="Download this building's data (Turtle)">
                    <IconButton
                      size="small"
                      onClick={() =>
                        handleDownloadBuilding(
                          (b.sourceUri ?? b.uri).split("#")[0],
                          b.id,
                        )}
                    >
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => {
              setImportMode(false);
              setAddBuildingOpen(true);
            }}
          >
            Add Building
          </Button>
          <Button
            variant="outlined"
            startIcon={<UploadFileIcon />}
            onClick={() => {
              setImportMode(true);
              setAddBuildingOpen(true);
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
              {viewDefinitions.map((view) => {
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
                                  disabled={revokingViewKey ===
                                    `${
                                      getSnapshotUrl(session.info.webId!, view.id)
                                    }__${webId}`}
                                >
                                  {revokingViewKey ===
                                      `${
                                        getSnapshotUrl(
                                          session.info.webId!,
                                          view.id,
                                        )
                                      }__${webId}`
                                    ? <CircularProgress size={16} />
                                    : <DeleteIcon fontSize="small" />}
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
                          disabled={refreshingViewId === view.id}
                        >
                          {refreshingViewId === view.id
                            ? <CircularProgress size={20} />
                            : <RefreshIcon />}
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
                          disabled={deletingViewId === view.id}
                        >
                          {deletingViewId === view.id
                            ? <CircularProgress size={20} />
                            : <DeleteIcon />}
                        </IconButton>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => setCreateViewOpen(true)}
        >
          Create View
        </Button>
      </section>

      <section>
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          Buildings you share
        </Typography>
        {rdf && <RdfSourceLink href={rdf.sharingRegistry} />}
        {loading
          ? <CircularProgress size={24} />
          : sharedBuildings.length === 0
          ? <p>No buildings shared yet.</p>
          : (
            <ul style={listStyle}>
              {sharedBuildings.map((building) => (
                <li key={building.buildingUri}>
                  Building {building.buildingId}
                  {building.sharedWith.length === 0
                    ? <p><small>Not shared with anyone</small></p>
                    : (
                      <ul style={nestedListStyle}>
                        {building.sharedWith.map((webId) => (
                          <li key={webId} style={rowStyle}>
                            <span title={webId} style={ellipsis}>{webId}</span>
                            <IconButton
                              size="small"
                              onClick={() =>
                                handleRevokeAccess(building.buildingUri, webId)}
                              title="Revoke access"
                              disabled={revokingBuildingKey ===
                                `${building.buildingUri}__${webId}`}
                            >
                              {revokingBuildingKey ===
                                  `${building.buildingUri}__${webId}`
                                ? <CircularProgress size={16} />
                                : <DeleteIcon fontSize="small" />}
                            </IconButton>
                          </li>
                        ))}
                      </ul>
                    )}
                </li>
              ))}
            </ul>
          )}
      </section>

      <section>
        <Typography variant="h6" sx={{ mt: 4, mb: 1 }}>
          Buildings shared with you
        </Typography>
        {loading
          ? <CircularProgress size={24} />
          : sharedWithMe.length === 0
          ? (
            <p>
              No buildings have been shared with you yet. Ask a building owner to
              share their data with your WebID.
            </p>
          )
          : (
            <ul style={listStyle}>
              {sharedWithMe.map((building) => (
                <li key={building.buildingUri} style={rowStyle}>
                  <span>
                    Building {building.buildingId}
                    <br />
                    <small>
                      Shared by: {building.sharedBy}
                      {building.sharedRole &&
                        ` — Role: ${
                          ROLE_LABELS[building.sharedRole] ?? building.sharedRole
                        }`}
                    </small>
                  </span>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.25rem",
                    }}
                  >
                    <Tooltip title="Download this building's data (Turtle)">
                      <IconButton
                        size="small"
                        onClick={() =>
                          handleDownloadBuilding(
                            building.buildingUri,
                            building.buildingId,
                          )}
                      >
                        <DownloadIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {togglingVisibility === building.buildingUri
                      ? <CircularProgress size={24} />
                      : (
                        <Tooltip title="Controls whether this building appears in your dashboard. Does not affect the owner's sharing settings.">
                          <label
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                            }}
                          >
                            <Switch
                              checked={building.isVisible}
                              onChange={() =>
                                handleToggleVisibility(building.buildingUri)}
                              icon={<VisibilityOffIcon />}
                              checkedIcon={<VisibilityIcon />}
                            />
                            {building.isVisible ? "Shown" : "Hidden"}
                          </label>
                        </Tooltip>
                      )}
                  </div>
                </li>
              ))}
            </ul>
          )}
      </section>

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
        onViewCreated={loadViewData}
      />
      <AddBuildingDialog
        open={addBuildingOpen}
        session={session}
        autostartImport={importMode}
        onClose={() => setAddBuildingOpen(false)}
        onBuildingAdded={() => {
          setAddBuildingOpen(false);
          reloadData();
        }}
      />
    </section>
  );
}

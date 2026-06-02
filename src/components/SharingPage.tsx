import { useEffect, useState } from "react";
import {
  Button,
  IconButton,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DownloadIcon from "@mui/icons-material/Download";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import RefreshIcon from "@mui/icons-material/Refresh";
import ShareIcon from "@mui/icons-material/Share";
import { useNavigate } from "react-router-dom";
import { Session } from "@inrupt/solid-client-authn-browser";
import {
  getSharedViews,
  getSharedWithMe,
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
import { tryPodResources } from "../services/utils/solidUtils.ts";
import { RdfSourceLink, UriLink } from "./detail/DetailView.tsx";
import ShareViewDialog from "./ShareViewDialog.tsx";
import CreateViewDialog from "./CreateViewDialog.tsx";

interface SharingPageProps {
  session: Session;
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
  const { buildings } = useSolidData();
  // Backing RDF resources, linked under each section so storage is inspectable.
  const rdf = session.info.webId ? tryPodResources(session.info.webId) : null;
  const navigate = useNavigate();
  const [createViewOpen, setCreateViewOpen] = useState(false);
  const [sharedWithMe, setSharedWithMe] = useState<SharedWithMeBuilding[]>([]);
  const [viewDefinitions, setViewDefinitions] = useState<
    AggregatedViewDefinition[]
  >([]);
  const [sharedViews, setSharedViews] = useState<SharedView[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshingViewId, setRefreshingViewId] = useState<string | null>(null);
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
    loadSharedWithMe();
    loadViewData();
  }, [session]);

  const loadSharedWithMe = async () => {
    setLoading(true);
    try {
      setSharedWithMe(await getSharedWithMe(session));
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
      await loadSharedWithMe();
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
                          disabled={refreshingViewId === view.id}
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
                          disabled={deletingViewId === view.id}
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
          Buildings shared with you
        </Typography>
        {loading
          ? <p>Loading…</p>
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
                  <span style={{ minWidth: 0 }}>
                    Building {building.buildingId}
                    <br />
                    <span style={{ wordBreak: "break-all" }}>
                      <UriLink href={building.buildingUri}>
                        {building.buildingUri}
                      </UriLink>
                    </span>
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
                          disabled={togglingVisibility === building.buildingUri}
                          icon={<VisibilityOffIcon />}
                          checkedIcon={<VisibilityIcon />}
                        />
                        {building.isVisible ? "Shown" : "Hidden"}
                      </label>
                    </Tooltip>
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
    </section>
  );
}

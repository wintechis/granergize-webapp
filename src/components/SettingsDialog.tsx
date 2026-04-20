import { useEffect, useState } from "react";
import {
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import RefreshIcon from "@mui/icons-material/Refresh";
import ShareIcon from "@mui/icons-material/Share";
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
import ShareViewDialog from "./ShareViewDialog.tsx";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
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

export default function SettingsDialog(
  { open, onClose, session }: SettingsDialogProps,
) {
  const { showNotification } = useNotification();
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
    if (open) {
      loadSharedBuildings();
      loadViewData();
    }
  }, [open]);

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
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          Sharing
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <Divider />
      <DialogContent
        sx={{ minHeight: 400, maxHeight: "70vh", overflowY: "auto" }}
      >
        <Box>
          {/* Buildings you share */}
          <Typography
            variant="subtitle1"
            fontWeight="medium"
            sx={{ mt: 1, mb: 1 }}
          >
            Buildings you share
          </Typography>
          {loading
            ? (
              <Box display="flex" justifyContent="center" py={2}>
                <CircularProgress size={24} />
              </Box>
            )
            : sharedBuildings.length === 0
            ? (
              <Typography color="textSecondary" variant="body2" sx={{ mb: 1 }}>
                No buildings shared yet.
              </Typography>
            )
            : (
              <List sx={{ maxHeight: 240, overflowY: "auto" }}>
                {sharedBuildings.map((building) => (
                  <Box key={building.buildingUri}>
                    <ListItem>
                      <ListItemText
                        primary={`Building ${building.buildingId}`}
                        secondary={
                          <Box component="span">
                            {building.sharedWith.length === 0
                              ? (
                                <Typography variant="body2" component="span">
                                  Not shared with anyone
                                </Typography>
                              )
                              : (
                                building.sharedWith.map((webId) => (
                                  <Box
                                    component="span"
                                    key={webId}
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="space-between"
                                    sx={{ mt: 1 }}
                                  >
                                    <Tooltip title={webId}>
                                      <Typography
                                        variant="body2"
                                        component="span"
                                        sx={{
                                          flex: 1,
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap",
                                          maxWidth: 320,
                                        }}
                                      >
                                        {webId}
                                      </Typography>
                                    </Tooltip>
                                    <IconButton
                                      size="small"
                                      onClick={() =>
                                        handleRevokeAccess(
                                          building.buildingUri,
                                          webId,
                                        )}
                                      title="Revoke access"
                                      disabled={revokingBuildingKey ===
                                        `${building.buildingUri}__${webId}`}
                                    >
                                      {revokingBuildingKey ===
                                          `${building.buildingUri}__${webId}`
                                        ? <CircularProgress size={16} />
                                        : <DeleteIcon fontSize="small" />}
                                    </IconButton>
                                  </Box>
                                ))
                              )}
                          </Box>
                        }
                      />
                    </ListItem>
                    <Divider />
                  </Box>
                ))}
              </List>
            )}

          <Divider sx={{ my: 3 }} />

          {/* Buildings shared with you */}
          <Typography variant="subtitle1" fontWeight="medium" sx={{ mb: 1 }}>
            Buildings shared with you
          </Typography>
          {loading
            ? (
              <Box display="flex" justifyContent="center" py={2}>
                <CircularProgress size={24} />
              </Box>
            )
            : sharedWithMe.length === 0
            ? (
              <Typography color="textSecondary" variant="body2" sx={{ mb: 1 }}>
                No buildings have been shared with you yet. Ask a building owner
                to share their data with your WebID.
              </Typography>
            )
            : (
              <List sx={{ maxHeight: 240, overflowY: "auto" }}>
                {sharedWithMe.map((building) => (
                  <Box key={building.buildingUri}>
                    <ListItem>
                      <ListItemText
                        primary={`Building ${building.buildingId}`}
                        secondary={
                          <>
                            {`Shared by: ${building.sharedBy}`}
                            {building.sharedRole && (
                              <Typography
                                variant="body2"
                                component="span"
                                display="block"
                              >
                                {`Role: ${
                                  ROLE_LABELS[building.sharedRole] ??
                                    building.sharedRole
                                }`}
                              </Typography>
                            )}
                          </>
                        }
                      />
                      {togglingVisibility === building.buildingUri
                        ? <CircularProgress size={24} sx={{ mx: 1 }} />
                        : (
                          <Tooltip title="Controls whether this building appears in your dashboard. Does not affect the owner's sharing settings.">
                            <FormControlLabel
                              control={
                                <Switch
                                  checked={building.isVisible}
                                  onChange={() =>
                                    handleToggleVisibility(
                                      building.buildingUri,
                                    )}
                                  icon={<VisibilityOffIcon />}
                                  checkedIcon={<VisibilityIcon />}
                                />
                              }
                              label={building.isVisible
                                ? "Shown in my dashboard"
                                : "Hidden from my dashboard"}
                            />
                          </Tooltip>
                        )}
                    </ListItem>
                    <Divider />
                  </Box>
                ))}
              </List>
            )}

          <Divider sx={{ my: 3 }} />

          {/* Aggregated views */}
          <Typography variant="subtitle1" fontWeight="medium" sx={{ mb: 1 }}>
            Aggregated views
          </Typography>
          {viewDefinitions.length === 0
            ? (
              <Typography color="textSecondary" variant="body2">
                No aggregated views yet. Create one from the Views tab on the
                main page.
              </Typography>
            )
            : (
              <List sx={{ maxHeight: 300, overflowY: "auto" }}>
                {viewDefinitions.map((view) => {
                  const sharedWith = getViewSharedWith(view.id);
                  return (
                    <Box key={view.id}>
                      <ListItem>
                        <ListItemText
                          primary={view.name}
                          secondary={
                            <Box component="span">
                              <Typography
                                variant="body2"
                                component="span"
                                display="block"
                              >
                                Type: {view.aggregationType} | Buildings:{" "}
                                {view.buildingUris.length} | Metrics:{" "}
                                {view.metrics.length}
                              </Typography>
                              <Typography
                                variant="body2"
                                component="span"
                                display="block"
                                color="textSecondary"
                              >
                                Created:{" "}
                                {new Date(view.createdAt).toLocaleDateString()}
                                {view.lastComputedAt &&
                                  ` | Last computed: ${
                                    new Date(view.lastComputedAt)
                                      .toLocaleDateString()
                                  }`}
                              </Typography>
                              {sharedWith.length > 0 && (
                                <Box component="span" sx={{ mt: 1 }}>
                                  <Typography
                                    variant="body2"
                                    component="span"
                                    color="primary"
                                  >
                                    Shared with:
                                  </Typography>
                                  {sharedWith.map((webId) => (
                                    <Box
                                      component="span"
                                      key={webId}
                                      display="flex"
                                      alignItems="center"
                                      justifyContent="space-between"
                                      sx={{ mt: 0.5 }}
                                    >
                                      <Tooltip title={webId}>
                                        <Typography
                                          variant="body2"
                                          component="span"
                                          sx={{
                                            flex: 1,
                                            fontSize: "0.8rem",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                            maxWidth: 280,
                                          }}
                                        >
                                          {webId}
                                        </Typography>
                                      </Tooltip>
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
                                            getSnapshotUrl(
                                              session.info.webId!,
                                              view.id,
                                            )
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
                                    </Box>
                                  ))}
                                </Box>
                              )}
                            </Box>
                          }
                        />
                        <Box display="flex" flexDirection="column" gap={1}>
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
                        </Box>
                      </ListItem>
                      <Divider />
                    </Box>
                  );
                })}
              </List>
            )}
        </Box>
      </DialogContent>

      {viewToShare && (
        <ShareViewDialog
          view={viewToShare}
          open={shareDialogOpen}
          onClose={handleCloseShareDialog}
          session={session}
        />
      )}
    </Dialog>
  );
}

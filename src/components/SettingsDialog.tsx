import { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  Tab,
  Tabs,
  Box,
  List,
  ListItem,
  ListItemText,
  IconButton,
  Typography,
  Divider,
  Switch,
  FormControlLabel,
  CircularProgress,
  Button,
  TextField,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import RefreshIcon from "@mui/icons-material/Refresh";
import ShareIcon from "@mui/icons-material/Share";
import { Session } from "@inrupt/solid-client-authn-browser";
import { getSharedBuildings, revokeAccess, getSharedWithMe, toggleBuildingVisibility, getSharedViews, revokeViewAccess } from "../services/interop/sharingManager.ts";
import { getViewDefinitions, deleteView, getSnapshotUrl } from "../services/aggregation/viewManager.ts";
import { refreshSnapshot } from "../services/aggregation/viewComputer.ts";
import { shareAggregatedView } from "../services/interop/share.ts";
import type { AggregatedViewDefinition } from "../../types/types.ts";
import { useSolidData } from "../context/SolidDataContext.tsx";
import { useNotification } from "../context/NotificationContext.tsx";
import SwitchAccountIcon from "@mui/icons-material/SwitchAccount";

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

export default function SettingsDialog({ open, onClose, session }: SettingsDialogProps) {
  const { role, setRole } = useSolidData();
  const { showNotification } = useNotification();
  const [tabValue, setTabValue] = useState(0);
  const [sharedBuildings, setSharedBuildings] = useState<SharedBuilding[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SharedWithMeBuilding[]>([]);
  const [viewDefinitions, setViewDefinitions] = useState<AggregatedViewDefinition[]>([]);
  const [sharedViews, setSharedViews] = useState<SharedView[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshingViewId, setRefreshingViewId] = useState<string | null>(null);
  const [revokingBuildingKey, setRevokingBuildingKey] = useState<string | null>(null);
  const [revokingViewKey, setRevokingViewKey] = useState<string | null>(null);
  const [deletingViewId, setDeletingViewId] = useState<string | null>(null);
  const [togglingVisibility, setTogglingVisibility] = useState<string | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [viewToShare, setViewToShare] = useState<AggregatedViewDefinition | null>(null);
  const [shareWebId, setShareWebId] = useState("");
  const [sharing, setSharing] = useState(false);

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
    const key = `${buildingUri}__${webId}`;
    setRevokingBuildingKey(key);
    try {
      await revokeAccess(buildingUri, webId, session);
      await loadSharedBuildings();
      showNotification("Access revoked", "success");
    } catch (error) {
      console.error("Error revoking access:", error);
      showNotification(`Failed to revoke access: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setRevokingBuildingKey(null);
    }
  };

  const handleToggleVisibility = async (buildingUri: string) => {
    setTogglingVisibility(buildingUri);
    try {
      await toggleBuildingVisibility(buildingUri, session);
      await loadSharedBuildings();
      showNotification("Visibility updated", "success");
    } catch (error) {
      console.error("Error toggling visibility:", error);
      showNotification(`Failed to toggle visibility: ${error instanceof Error ? error.message : String(error)}`, "error");
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
      showNotification(`Failed to refresh view: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setRefreshingViewId(null);
    }
  };

  const handleDeleteView = async (viewId: string) => {
    if (!confirm("Are you sure you want to delete this view? This will also revoke access for all shared users.")) {
      return;
    }
    setDeletingViewId(viewId);
    try {
      await deleteView(session, viewId);
      await loadViewData();
      showNotification("View deleted", "success");
    } catch (error) {
      console.error("Error deleting view:", error);
      showNotification(`Failed to delete view: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setDeletingViewId(null);
    }
  };

  const handleOpenShareDialog = (view: AggregatedViewDefinition) => {
    setViewToShare(view);
    setShareWebId("");
    setShareDialogOpen(true);
  };

  const handleCloseShareDialog = () => {
    setShareDialogOpen(false);
    setViewToShare(null);
    setShareWebId("");
  };

  const handleShareView = async () => {
    if (!viewToShare || !shareWebId.trim()) return;
    
    setSharing(true);
    try {
      const snapshotUrl = getSnapshotUrl(session.info.webId!, viewToShare.id);
      await shareAggregatedView(snapshotUrl, viewToShare.id, shareWebId.trim(), session);
      await loadViewData();
      handleCloseShareDialog();
      showNotification("View shared successfully", "success");
    } catch (error) {
      console.error("Error sharing view:", error);
      showNotification(`Failed to share view: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setSharing(false);
    }
  };

  const handleRevokeViewAccess = async (snapshotUrl: string, webId: string) => {
    const key = `${snapshotUrl}__${webId}`;
    setRevokingViewKey(key);
    try {
      await revokeViewAccess(snapshotUrl, webId, session);
      await loadViewData();
      showNotification("View access revoked", "success");
    } catch (error) {
      console.error("Error revoking view access:", error);
      showNotification(`Failed to revoke access: ${error instanceof Error ? error.message : String(error)}`, "error");
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

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setTabValue(newValue);
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
          Settings
          <IconButton onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <Divider />
      <Tabs value={tabValue} onChange={handleTabChange} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tab label="Buildings I Share" />
        <Tab label="Buildings Shared With Me" />
        <Tab label="Aggregated Views" />
        <Tab label="Role" />
      </Tabs>
      <DialogContent sx={{ minHeight: 400 }}>
        {loading ? (
          <Box display="flex" justifyContent="center" alignItems="center" height={300}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {tabValue === 0 && (
              <Box>
                {sharedBuildings.length === 0 ? (
                  <Typography color="textSecondary" sx={{ mt: 2 }}>
                    You haven't shared any buildings yet.
                  </Typography>
                ) : (
                  <List>
                    {sharedBuildings.map((building) => (
                      <Box key={building.buildingUri}>
                        <ListItem>
                          <ListItemText
                            primary={`Building ${building.buildingId}`}
                            secondary={
                              <Box component="span">
                                {building.sharedWith.length === 0 ? (
                                  <Typography variant="body2" component="span">
                                    Not shared with anyone
                                  </Typography>
                                ) : (
                                  building.sharedWith.map((webId) => (
                                    <Box
                                      component="span"
                                      key={webId}
                                      display="flex"
                                      alignItems="center"
                                      justifyContent="space-between"
                                      sx={{ mt: 1 }}
                                    >
                                      <Typography variant="body2" component="span" sx={{ flex: 1 }}>
                                        {webId}
                                      </Typography>
                                      <IconButton
                                        size="small"
                                        onClick={() => handleRevokeAccess(building.buildingUri, webId)}
                                        title="Revoke access"
                                        disabled={revokingBuildingKey === `${building.buildingUri}__${webId}`}
                                      >
                                        {revokingBuildingKey === `${building.buildingUri}__${webId}` ? (
                                          <CircularProgress size={16} />
                                        ) : (
                                          <DeleteIcon fontSize="small" />
                                        )}
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
              </Box>
            )}
            {tabValue === 1 && (
              <Box>
                {sharedWithMe.length === 0 ? (
                  <Typography color="textSecondary" sx={{ mt: 2 }}>
                    No buildings have been shared with you yet.
                  </Typography>
                ) : (
                  <List>
                    {sharedWithMe.map((building) => (
                      <Box key={building.buildingUri}>
                        <ListItem>
                          <ListItemText
                            primary={`Building ${building.buildingId}`}
                            secondary={
                              <>
                                {`Shared by: ${building.sharedBy}`}
                                {building.sharedRole && (
                                  <Typography variant="body2" component="span" display="block">
                                    {`Role: ${ROLE_LABELS[building.sharedRole] ?? building.sharedRole}`}
                                  </Typography>
                                )}
                              </>
                            }
                          />
                          {togglingVisibility === building.buildingUri ? (
                            <CircularProgress size={24} sx={{ mx: 1 }} />
                          ) : (
                            <FormControlLabel
                              control={
                                <Switch
                                  checked={building.isVisible}
                                  onChange={() => handleToggleVisibility(building.buildingUri)}
                                  icon={<VisibilityOffIcon />}
                                  checkedIcon={<VisibilityIcon />}
                                />
                              }
                              label={building.isVisible ? "Visible" : "Hidden"}
                            />
                          )}
                        </ListItem>
                        <Divider />
                      </Box>
                    ))}
                  </List>
                )}
              </Box>
            )}
            {tabValue === 2 && (
              <Box>
                {viewDefinitions.length === 0 ? (
                  <Typography color="textSecondary" sx={{ mt: 2 }}>
                    You haven't created any aggregated views yet.
                    Use the "Create View" button on the main page to create one.
                  </Typography>
                ) : (
                  <List>
                    {viewDefinitions.map((view) => {
                      const sharedWith = getViewSharedWith(view.id);
                      return (
                        <Box key={view.id}>
                          <ListItem>
                            <ListItemText
                              primary={view.name}
                              secondary={
                                <Box component="span">
                                  <Typography variant="body2" component="span" display="block">
                                    Type: {view.aggregationType} | Buildings: {view.buildingUris.length} | Metrics: {view.metrics.length}
                                  </Typography>
                                  <Typography variant="body2" component="span" display="block" color="textSecondary">
                                    Created: {new Date(view.createdAt).toLocaleDateString()}
                                    {view.lastComputedAt && ` | Last computed: ${new Date(view.lastComputedAt).toLocaleDateString()}`}
                                  </Typography>
                                  {sharedWith.length > 0 && (
                                    <Box component="span" sx={{ mt: 1 }}>
                                      <Typography variant="body2" component="span" color="primary">
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
                                          <Typography variant="body2" component="span" sx={{ flex: 1, fontSize: "0.8rem" }}>
                                            {webId}
                                          </Typography>
                                          <IconButton
                                            size="small"
                                            onClick={() => handleRevokeViewAccess(
                                              getSnapshotUrl(session.info.webId!, view.id),
                                              webId
                                            )}
                                            title="Revoke access"
                                            disabled={revokingViewKey === `${getSnapshotUrl(session.info.webId!, view.id)}__${webId}`}
                                          >
                                            {revokingViewKey === `${getSnapshotUrl(session.info.webId!, view.id)}__${webId}` ? (
                                              <CircularProgress size={16} />
                                            ) : (
                                              <DeleteIcon fontSize="small" />
                                            )}
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
                                {refreshingViewId === view.id ? (
                                  <CircularProgress size={20} />
                                ) : (
                                  <RefreshIcon />
                                )}
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
                                {deletingViewId === view.id ? (
                                  <CircularProgress size={20} />
                                ) : (
                                  <DeleteIcon />
                                )}
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
            )}
            {tabValue === 3 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
                  Current role
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 2,
                    p: 2,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 1,
                    mb: 3,
                  }}
                >
                  <SwitchAccountIcon color="primary" />
                  <Typography variant="body1">
                    {role ? ROLE_LABELS[role] ?? role : "None"}
                  </Typography>
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Changing your role will reload all data. The current role is stored
                  locally in your browser.
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={<SwitchAccountIcon />}
                  onClick={() => {
                    setRole(null);
                    onClose();
                  }}
                >
                  Change role
                </Button>
              </Box>
            )}
          </>
        )}
      </DialogContent>

      {/* Share View Dialog */}
      <Dialog open={shareDialogOpen} onClose={handleCloseShareDialog}>
        <DialogTitle>Share Aggregated View</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Share "{viewToShare?.name}" with another user. They will receive access
            to the computed snapshot values only, without seeing which buildings
            were included.
          </Typography>
          <TextField
            autoFocus
            margin="dense"
            label="Recipient WebID"
            type="url"
            fullWidth
            variant="outlined"
            value={shareWebId}
            onChange={(e) => setShareWebId(e.target.value)}
            placeholder="https://example.solidcommunity.net/profile/card#me"
          />
        </DialogContent>
        <Box sx={{ display: "flex", justifyContent: "flex-end", p: 2, gap: 1 }}>
          <Button onClick={handleCloseShareDialog} disabled={sharing}>
            Cancel
          </Button>
          <Button
            onClick={handleShareView}
            variant="contained"
            disabled={!shareWebId.trim() || sharing}
          >
            {sharing ? <CircularProgress size={20} /> : "Share"}
          </Button>
        </Box>
      </Dialog>
    </Dialog>
  );
}

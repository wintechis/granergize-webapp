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
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { Session } from "@inrupt/solid-client-authn-browser";
import { getSharedBuildings, revokeAccess, getSharedWithMe, toggleBuildingVisibility } from "../services/interop/sharingManager.ts";

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
}

export default function SettingsDialog({ open, onClose, session }: SettingsDialogProps) {
  const [tabValue, setTabValue] = useState(0);
  const [sharedBuildings, setSharedBuildings] = useState<SharedBuilding[]>([]);
  const [sharedWithMe, setSharedWithMe] = useState<SharedWithMeBuilding[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      loadSharedBuildings();
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

  const handleRevokeAccess = async (buildingUri: string, webId: string) => {
    try {
      await revokeAccess(buildingUri, webId, session);
      await loadSharedBuildings();
    } catch (error) {
      console.error("Error revoking access:", error);
      alert(`Failed to revoke access: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleToggleVisibility = async (buildingUri: string) => {
    try {
      await toggleBuildingVisibility(buildingUri, session);
      await loadSharedBuildings();
    } catch (error) {
      console.error("Error toggling visibility:", error);
      alert(`Failed to toggle visibility: ${error instanceof Error ? error.message : String(error)}`);
    }
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
                                      key={webId}
                                      display="flex"
                                      alignItems="center"
                                      justifyContent="space-between"
                                      sx={{ mt: 1 }}
                                    >
                                      <Typography variant="body2" sx={{ flex: 1 }}>
                                        {webId}
                                      </Typography>
                                      <IconButton
                                        size="small"
                                        onClick={() => handleRevokeAccess(building.buildingUri, webId)}
                                        title="Revoke access"
                                      >
                                        <DeleteIcon fontSize="small" />
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
                            secondary={`Shared by: ${building.sharedBy}`}
                          />
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
                        </ListItem>
                        <Divider />
                      </Box>
                    ))}
                  </List>
                )}
              </Box>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

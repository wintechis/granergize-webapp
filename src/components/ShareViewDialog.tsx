import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  CircularProgress,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Divider,
  Box,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { Session } from "@inrupt/solid-client-authn-browser";
import { AggregatedViewDefinition } from "../../types/types.ts";
import { shareAggregatedView } from "../services/interop/share.ts";
import { getSharedViews, revokeViewAccess } from "../services/interop/sharingManager.ts";
import { getSnapshotUrl } from "../services/aggregation/viewManager.ts";

interface ShareViewDialogProps {
  open: boolean;
  onClose: () => void;
  view: AggregatedViewDefinition;
  session: Session;
}

export default function ShareViewDialog({ open, onClose, view, session }: ShareViewDialogProps) {
  const [recipientWebId, setRecipientWebId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [loadingShared, setLoadingShared] = useState(false);

  const loadSharedUsers = async () => {
    if (!session.info.webId) return;
    setLoadingShared(true);
    try {
      const shares = await getSharedViews(session);
      const viewShares = shares.filter(s => s.viewId === view.id);
      // Flatten sharedWith arrays from matching shares
      const allSharedWith = viewShares.flatMap(s => s.sharedWith);
      setSharedWith([...new Set(allSharedWith)]);
    } catch (err) {
      console.error("Failed to load shared users:", err);
    } finally {
      setLoadingShared(false);
    }
  };

  // Load shared users when dialog opens
  const handleEntered = () => {
    loadSharedUsers();
  };

  const handleShare = async () => {
    if (!session.info.webId || !recipientWebId.trim()) return;

    // Basic WebID validation
    if (!recipientWebId.startsWith("http")) {
      setError("Please enter a valid WebID (should start with http:// or https://)");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const snapshotUrl = getSnapshotUrl(session.info.webId!, view.id);
      await shareAggregatedView(snapshotUrl, view.id, recipientWebId.trim(), session);
      setSuccess(`View shared with ${recipientWebId}`);
      setRecipientWebId("");
      loadSharedUsers();
    } catch (err) {
      setError(`Failed to share view: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (webId: string) => {
    if (!session.info.webId) return;
    if (!globalThis.confirm(`Revoke access for ${webId}?`)) return;

    setLoading(true);
    setError(null);
    try {
      await revokeViewAccess(view.id, webId, session);
      loadSharedUsers();
    } catch (err) {
      setError(`Failed to revoke access: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setRecipientWebId("");
    setError(null);
    setSuccess(null);
    onClose();
  };

  return (
    <Dialog 
      open={open} 
      onClose={handleClose} 
      maxWidth="sm" 
      fullWidth
      TransitionProps={{ onEntered: handleEntered }}
    >
      <DialogTitle>Share "{view.name}"</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Share this aggregated view with another user by entering their WebID.
          They will receive read access to the computed snapshot (values only, no building details).
        </Typography>

        <TextField
          label="Recipient WebID"
          fullWidth
          value={recipientWebId}
          onChange={(e) => setRecipientWebId(e.target.value)}
          placeholder="https://example.solidcommunity.net/profile/card#me"
          disabled={loading}
          sx={{ mb: 2 }}
        />

        <Button
          variant="contained"
          onClick={handleShare}
          disabled={loading || !recipientWebId.trim()}
          startIcon={loading ? <CircularProgress size={20} /> : null}
        >
          Share View
        </Button>

        <Divider sx={{ my: 3 }} />

        <Typography variant="subtitle2" gutterBottom>
          Currently shared with:
        </Typography>

        {loadingShared ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        ) : sharedWith.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            This view hasn't been shared with anyone yet.
          </Typography>
        ) : (
          <List dense>
            {sharedWith.map((webId) => (
              <ListItem key={webId}>
                <ListItemText 
                  primary={webId}
                  primaryTypographyProps={{ 
                    sx: { 
                      overflow: "hidden", 
                      textOverflow: "ellipsis",
                      fontSize: "0.875rem"
                    } 
                  }}
                />
                <ListItemSecondaryAction>
                  <IconButton
                    edge="end"
                    size="small"
                    onClick={() => handleRevoke(webId)}
                    disabled={loading}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

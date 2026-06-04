import { useEffect, useState } from "react";
import Modal from "./Modal.tsx";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import { Session } from "@inrupt/solid-client-authn-browser";
import { AggregatedViewDefinition } from "../../types/types.ts";
import { shareAggregatedView } from "../services/interop/share.ts";
import {
  getSharedViews,
  revokeViewAccess,
} from "../services/interop/sharingManager.ts";
import { getSnapshotUrl } from "../services/aggregation/viewManager.ts";
import {
  type DataRoomMember,
  getActiveRoom,
  getMembers,
} from "../services/interop/dataRoom.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { formatError } from "../services/utils/formatError.ts";
import { ROLE_LABELS } from "../constants/roles.ts";

interface ShareViewDialogProps {
  open: boolean;
  onClose: () => void;
  view: AggregatedViewDefinition;
  session: Session;
}

export default function ShareViewDialog(
  { open, onClose, view, session }: ShareViewDialogProps,
) {
  const { showNotification } = useNotification();
  const [recipientWebId, setRecipientWebId] = useState("");
  const [loading, setLoading] = useState(false);
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [loadingShared, setLoadingShared] = useState(false);
  const [webIdError, setWebIdError] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);
  const [successRecipients, setSuccessRecipients] = useState<string[]>([]);
  const [members, setMembers] = useState<DataRoomMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  const getRecipients = () =>
    recipientWebId.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);

  /** Append a member's WebID to the recipient field (deduped). */
  const addRecipient = (webId: string) => {
    const current = getRecipients();
    if (current.includes(webId)) return;
    setRecipientWebId([...current, webId].join("\n"));
    setWebIdError(null);
    setShareSuccess(false);
  };

  const loadSharedUsers = async () => {
    if (!session.info.webId) return;
    setLoadingShared(true);
    try {
      const shares = await getSharedViews(session);
      const viewShares = shares.filter((s) => s.viewId === view.id);
      const allSharedWith = viewShares.flatMap((s) => s.sharedWith);
      setSharedWith([...new Set(allSharedWith)]);
    } catch (err) {
      console.error("Failed to load shared users:", err);
    } finally {
      setLoadingShared(false);
    }
  };

  const loadMembers = async () => {
    setMembersLoading(true);
    try {
      const all = await getMembers(getActiveRoom(), session);
      // Exclude yourself — you can't share a view with your own WebID.
      setMembers(all.filter((m) => m.webId !== session.info.webId));
    } catch (err) {
      console.error("Failed to load data room members:", err);
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  };

  // Load the current shares and data-room members when the dialog opens (the
  // native <dialog> has no enter-transition hook to hang this off).
  useEffect(() => {
    if (!open) return;
    loadSharedUsers();
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleProceedToConfirm = () => {
    const recipients = getRecipients();
    if (recipients.length === 0) {
      setWebIdError("Enter at least one WebID");
      return;
    }
    const invalid = recipients.filter((r) => {
      try {
        new URL(r);
        return false;
      } catch {
        return true;
      }
    });
    if (invalid.length > 0) {
      setWebIdError(
        `Invalid WebID${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}`,
      );
      return;
    }
    setWebIdError(null);
    setShareError(null);
    setConfirmStep(true);
  };

  const handleConfirmShare = async () => {
    if (!session.info.webId) return;
    const recipients = getRecipients();

    setLoading(true);
    setShareError(null);
    try {
      const snapshotUrl = getSnapshotUrl(session.info.webId!, view.id);
      for (const recipient of recipients) {
        await shareAggregatedView(snapshotUrl, recipient, session);
      }
      setSuccessRecipients(recipients);
      setShareSuccess(true);
      setConfirmStep(false);
      showNotification(`View shared with ${recipients.join(", ")}`, "success");
      setRecipientWebId("");
      loadSharedUsers();
    } catch (err) {
      setShareError(err instanceof Error ? err.message : String(err));
      setConfirmStep(false);
    } finally {
      setLoading(false);
    }
  };

  const handleRevoke = async (webId: string) => {
    if (!session.info.webId) return;
    if (!globalThis.confirm(`Revoke access for ${webId}?`)) return;

    setLoading(true);
    try {
      await revokeViewAccess(
        getSnapshotUrl(session.info.webId, view.id),
        webId,
        session,
      );
      showNotification("View access revoked", "success");
      loadSharedUsers();
    } catch (err) {
      showNotification(formatError("revoke access", err), "error");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setRecipientWebId("");
    setWebIdError(null);
    setShareError(null);
    setConfirmStep(false);
    setShareSuccess(false);
    setSuccessRecipients([]);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dirty={recipientWebId.trim() !== ""}
      busy={loading}
      title={`Share "${view.name}"`}
      actions={<Button onClick={handleClose}>Close</Button>}
    >
      {loading
        ? (
          <Typography variant="body2" color="text.secondary">Loading…</Typography>
        )
        : (
        <>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Share this aggregated view with another user by entering their
            WebID. They will receive read access to the computed snapshot
            (values only, no building details).
          </Typography>

          {shareSuccess && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Shared successfully with {successRecipients.join(", ")}
            </Alert>
          )}

          {shareError && !confirmStep && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {shareError}
            </Alert>
          )}

          {!confirmStep && (
            <>
              <Typography variant="h6" gutterBottom>
                Data room members
              </Typography>
              {membersLoading
                ? (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                    Loading…
                  </Typography>
                )
                : members.length === 0
                ? (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2 }}
                  >
                    No other members in your active data room. Enter a WebID
                    below instead.
                  </Typography>
                )
                : (
                  <List dense sx={{ mb: 1 }}>
                    {members.map((m) => {
                      const inField = getRecipients().includes(m.webId);
                      const alreadyShared = sharedWith.includes(m.webId);
                      return (
                        <ListItem key={m.webId}>
                          <ListItemText
                            primary={m.webId}
                            secondary={m.roles.map((r) => ROLE_LABELS[r] ?? r)
                              .join(", ") || "no role"}
                            primaryTypographyProps={{
                              variant: "body2",
                              sx: {
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              },
                            }}
                          />
                          <ListItemSecondaryAction>
                            <Button
                              onClick={() => addRecipient(m.webId)}
                              disabled={inField || alreadyShared}
                            >
                              {alreadyShared
                                ? "Shared"
                                : inField
                                ? "Added"
                                : "Add"}
                            </Button>
                          </ListItemSecondaryAction>
                        </ListItem>
                      );
                    })}
                  </List>
                )}

              <TextField
                label="Recipient WebID(s)"
                fullWidth
                multiline
                minRows={2}
                value={recipientWebId}
                onChange={(e) => {
                  setRecipientWebId(e.target.value);
                  if (webIdError) setWebIdError(null);
                  if (shareSuccess) setShareSuccess(false);
                }}
                placeholder="https://example.solidcommunity.net/profile/card#me"
                disabled={loading}
                error={!!webIdError}
                helperText={webIdError ||
                  "One WebID per line, or comma-separated"}
                sx={{ mb: 2 }}
              />
              <Button
                variant="contained"
                onClick={handleProceedToConfirm}
                disabled={loading || !recipientWebId.trim()}
              >
                Review & Share
              </Button>
            </>
          )}

          {confirmStep && (
            <Box sx={{ mb: 2 }}>
              {shareError && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {shareError}
                </Alert>
              )}
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Confirm sharing with:
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2 }}>
                {getRecipients().map((r) => (
                  <Chip key={r} label={r} size="small" variant="outlined" />
                ))}
              </Box>
              <Typography variant="body2" sx={{ mb: 2 }}>
                Recipients will see computed snapshot values only — no building
                details.
              </Typography>
              <Box sx={{ display: "flex", gap: 1 }}>
                <Button onClick={() => setConfirmStep(false)}>Back</Button>
                <Button variant="contained" onClick={handleConfirmShare}>
                  Confirm Share
                </Button>
              </Box>
            </Box>
          )}

          <Divider sx={{ my: 3 }} />

          <Typography variant="h6" gutterBottom>
            Currently shared with:
          </Typography>

          {loadingShared
            ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                Loading…
              </Typography>
            )
            : sharedWith.length === 0
            ? (
              <Typography variant="body2" color="text.secondary">
                Not shared with anyone yet.
              </Typography>
            )
            : (
              <List dense>
                {sharedWith.map((webId) => (
                  <ListItem key={webId}>
                    <ListItemText
                      primary={webId}
                      primaryTypographyProps={{
                        variant: "body2",
                        sx: {
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        },
                      }}
                    />
                    <ListItemSecondaryAction>
                      <Tooltip title="Revoke access">
                        <span>
                          <IconButton
                            edge="end"
                            size="small"
                            aria-label="Revoke access"
                            onClick={() => handleRevoke(webId)}
                            disabled={loading}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            )}
        </>
      )}
    </Modal>
  );
}

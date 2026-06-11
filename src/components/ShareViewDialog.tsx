import { useMemo, useState } from "react";
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
import { AggregatedViewDefinition } from "../types.ts";
import { logError } from "../lib/logError.ts";
import {
  useRevokeViewAccess,
  useShareViewSnapshot,
} from "../hooks/mutations.ts";
import {
  useRoomState,
  useSharedViews,
  useSharedWithMe,
} from "../hooks/queries.ts";
import { classifyQueryError } from "../hooks/queryErrors.ts";
import { getSnapshotUrl } from "../services/aggregation/viewManager.ts";
import { summarizeContributors } from "../services/aggregation/viewComputer.ts";
import { useNotification } from "../context/NotificationContext.tsx";

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
  const [webIdError, setWebIdError] = useState<string | null>(null);
  const [confirmStep, setConfirmStep] = useState(false);
  // The writes go through mutation hooks: busy/success/error are their state,
  // and the share error renders inline (silent hook) through the same
  // classifier the central toast would use. The "currently shared with" list
  // derives from the folded shared-out log (no per-open re-fold); the hooks'
  // sharedOutLog invalidation refreshes it after a share/revoke.
  const share = useShareViewSnapshot({ silent: true });
  const revoke = useRevokeViewAccess();
  const loading = share.isPending || revoke.isPending;
  const shareError = share.error
    ? classifyQueryError(share.error).message
    : null;
  const shareSuccess = share.isSuccess;
  const successRecipients = share.variables?.recipients ?? [];
  const sharedViewsQuery = useSharedViews();
  const sharedWith = useMemo(() => {
    const shares = (sharedViewsQuery.data ?? []).filter(
      (s) => s.viewId === view.id,
    );
    return [...new Set(shares.flatMap((s) => s.sharedWith))];
  }, [sharedViewsQuery.data, view.id]);
  const loadingShared = sharedViewsQuery.isLoading;
  // The reads are queries too — the dialog mounts fresh per open (ManagePage
  // renders it conditionally), so subscribing here refetches on open like the
  // old per-open loads did, but through the shared caches: members from the
  // room-log query (one fold, refreshed by role saves), contributors derived
  // in memory from the shared-in fold (never fold a log in a component).
  const room = useRoomState();
  const members = useMemo(
    // Exclude yourself — you can't share a view with your own WebID.
    () =>
      (room.data?.members ?? []).filter((m) =>
        m.webId !== session.info.webId
      ),
    [room.data?.members, session.info.webId],
  );
  const membersLoading = room.isLoading || room.isFetching;
  // When this view is a benchmark, the WebIDs that contributed buildings to it —
  // the natural share-back targets, offered as a one-click "add all" below.
  // The snapshot's isBenchmark flag is derived from the definition's benchmark
  // flag at compute time, so the definition prop already answers "is this a
  // benchmark?" — no per-open snapshot fetch.
  const isBenchmarkView = Boolean(view.benchmark);
  const sharedWithMe = useSharedWithMe();
  const contributors = useMemo(
    () =>
      isBenchmarkView
        ? summarizeContributors(sharedWithMe.data ?? []).contributors
        : [],
    [isBenchmarkView, sharedWithMe.data],
  );

  const getRecipients = () =>
    recipientWebId.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);

  /** Append a member's WebID to the recipient field (deduped). */
  const addRecipient = (webId: string) => {
    const current = getRecipients();
    if (current.includes(webId)) return;
    setRecipientWebId([...current, webId].join("\n"));
    setWebIdError(null);
    if (share.isSuccess) share.reset();
  };

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
      } catch (err) {
        logError("validate view-share recipient WebID", err);
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
    setConfirmStep(true);
  };

  const handleConfirmShare = () => {
    if (!session.info.webId) return;
    const recipients = getRecipients();
    const snapshotUrl = getSnapshotUrl(session.info.webId, view.id);
    share.mutate({ snapshotUrl, recipients }, {
      onSuccess: () => {
        setConfirmStep(false);
        showNotification(
          `View shared with ${recipients.join(", ")}`,
          "success",
        );
        setRecipientWebId("");
      },
      // Back to the form step, where the inline error Alert renders.
      onError: () => setConfirmStep(false),
    });
  };

  const handleRevoke = (webId: string) => {
    if (!session.info.webId) return;
    if (!globalThis.confirm(`Revoke access for ${webId}?`)) return;
    revoke.mutate(
      { snapshotUrl: getSnapshotUrl(session.info.webId, view.id), webId },
      { onSuccess: () => showNotification("View access revoked", "success") },
    );
  };

  const handleClose = () => {
    setRecipientWebId("");
    setWebIdError(null);
    setConfirmStep(false);
    share.reset();
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
              {isBenchmarkView && contributors.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    This is a benchmark. Share it back to everyone who contributed
                    a building so they can compare against the peer average.
                  </Typography>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      // Add ALL contributors in one state update — calling
                      // addRecipient per item would read stale field state each
                      // iteration (React hasn't re-rendered), so only the last
                      // would survive.
                      const merged = [
                        ...new Set([...getRecipients(), ...contributors]),
                      ];
                      setRecipientWebId(merged.join("\n"));
                      setWebIdError(null);
                      if (share.isSuccess) share.reset();
                    }}
                    disabled={contributors.every((w) =>
                      getRecipients().includes(w) || sharedWith.includes(w)
                    )}
                  >
                    Add all {contributors.length} contributors
                  </Button>
                </Box>
              )}

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
                  if (share.isSuccess) share.reset();
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

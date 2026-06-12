import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Modal from "./Modal.tsx";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
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
  queryKeys,
  useRoomState,
  useSharedViews,
  useSharedWithMe,
} from "../hooks/queries.ts";
import { classifyQueryError } from "../hooks/queryErrors.ts";
import { getSnapshotUrl } from "../services/aggregation/viewManager.ts";
import { summarizeContributors } from "../services/aggregation/viewComputer.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { AgentChip, AgentLabel } from "./AgentLabel.tsx";
import { useAgentOptions } from "../hooks/useAgentOptions.ts";

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
  const agentOptions = useAgentOptions();
  const [recipients, setRecipients] = useState<string[]>([]);
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
  // The room log is CROSS-AGENT state: a member's join is appended by THEM
  // into the room container, so no local write ever invalidates it — and the
  // global policy is refetch-on-invalidation only (refetchOnMount: false).
  // Opening this dialog is the user's "look" at the membership (the pull
  // topology: readers fold the container when they look), so it triggers the
  // one refetch. The dialog mounts fresh per open, so once per open.
  const qc = useQueryClient();
  useEffect(() => {
    qc.invalidateQueries({ queryKey: queryKeys.roomLog });
  }, [qc]);
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

  /** Append a member's WebID to the recipient tokens (deduped). */
  const addRecipient = (webId: string) => {
    setRecipients((prev) => prev.includes(webId) ? prev : [...prev, webId]);
    setWebIdError(null);
    if (share.isSuccess) share.reset();
  };

  const handleProceedToConfirm = () => {
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
    const snapshotUrl = getSnapshotUrl(session.info.webId, view.id);
    share.mutate({ snapshotUrl, recipients }, {
      onSuccess: () => {
        setConfirmStep(false);
        showNotification(
          `View shared with ${recipients.length} recipient${
            recipients.length === 1 ? "" : "s"
          }`,
          "success",
        );
        setRecipients([]);
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
    setRecipients([]);
    setWebIdError(null);
    setConfirmStep(false);
    share.reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dirty={recipients.length > 0}
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
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 0.5,
                }}
              >
                Shared successfully with{" "}
                {successRecipients.map((r) => (
                  <AgentChip key={r} value={r} size="small" variant="outlined" />
                ))}
              </Box>
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
                      setRecipients((prev) => [
                        ...new Set([...prev, ...contributors]),
                      ]);
                      setWebIdError(null);
                      if (share.isSuccess) share.reset();
                    }}
                    disabled={contributors.every((w) =>
                      recipients.includes(w) || sharedWith.includes(w)
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
                      const inField = recipients.includes(m.webId);
                      const alreadyShared = sharedWith.includes(m.webId);
                      return (
                        <ListItem key={m.webId}>
                          <ListItemText
                            primary={<AgentLabel value={m.webId} />}
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

              <Autocomplete
                multiple
                freeSolo
                options={agentOptions}
                value={recipients}
                onChange={(_e, value) => {
                  setRecipients(value as string[]);
                  if (webIdError) setWebIdError(null);
                  if (share.isSuccess) share.reset();
                }}
                disabled={loading}
                renderOption={(props, option) => (
                  <Box component="li" {...props} key={option}>
                    <AgentLabel value={option} />
                  </Box>
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <AgentChip
                      {...getTagProps({ index })}
                      key={option}
                      value={option}
                      size="small"
                    />
                  ))}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Recipient WebID(s)"
                    error={!!webIdError}
                    helperText={webIdError ||
                      "Pick a contact/member, or type a WebID and press Enter"}
                    sx={{ mb: 2 }}
                  />
                )}
              />
              <Button
                variant="contained"
                onClick={handleProceedToConfirm}
                disabled={loading || recipients.length === 0}
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
                {recipients.map((r) => (
                  <AgentChip key={r} value={r} size="small" variant="outlined" />
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
                      primary={<AgentLabel value={webId} />}
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

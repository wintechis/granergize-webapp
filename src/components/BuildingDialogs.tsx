import { useMemo, useState } from "react";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { Session } from "@inrupt/solid-client-authn-browser";
import Modal from "./Modal.tsx";
import { logError } from "../lib/logError.ts";
import { getActiveRoom, getMembersByRole } from "../services/interop/dataRoom.ts";
import { fetchAttachmentBlob } from "../services/attachmentManager.ts";
import {
  useDeleteAttachment,
  useSetEnergyCertificate,
  useShareBuilding,
  useUploadAttachments,
} from "../hooks/mutations.ts";
import { classifyQueryError } from "../hooks/queryErrors.ts";
import { downloadBlob, formatBytes } from "../lib/download.ts";
import { listStyle, rowStyle } from "../constants/listStyles.ts";
import type { AttachmentRef, BuildingType, UserRole } from "../types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { formatError } from "../lib/formatError.ts";
import { useAgentOptions } from "../hooks/useAgentOptions.ts";
import { AgentChip, AgentLabel } from "./AgentLabel.tsx";
import { ROLE_LABELS, ROOM_ROLE_OPTIONS } from "../constants/roles.ts";

/**
 * Roles selectable as a sharing target (resolved to member WebIDs via the data
 * room). Derived from the central role lists so new roles surface here
 * automatically and can't drift.
 */
const SHARE_ROLE_OPTIONS: { value: UserRole; label: string }[] = ROOM_ROLE_OPTIONS
  .map((value) => ({ value, label: ROLE_LABELS[value] ?? value }));

/** What energy a share grants alongside the always-shared static building data. */
type ShareScope = "static" | "all" | "years";

interface ShareBuildingDialogProps {
  open: boolean;
  buildingUri: string;
  /** The building being shared — its energy datasets drive the per-year picker. */
  building: BuildingType;
  session: Session;
  onClose: () => void;
}

export function ShareBuildingDialog({
  open,
  buildingUri,
  building,
  session,
  onClose,
}: ShareBuildingDialogProps) {
  const { showNotification } = useNotification();
  const agentOptions = useAgentOptions();
  const [shareMode, setShareMode] = useState<"webid" | "role">("webid");
  const [webIds, setWebIds] = useState<string[]>([]);
  const [targetRole, setTargetRole] = useState<UserRole | "">("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);
  const [shareScope, setShareScope] = useState<ShareScope>("all");
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [webIdError, setWebIdError] = useState("");
  const [confirmStep, setConfirmStep] = useState(false);
  // The write goes through the (silent) mutation hook: busy/success/error are
  // its state; the error renders inline through the same classifier the central
  // toast would use, so the wording can't fork.
  const share = useShareBuilding();
  const sharing = share.isPending;
  const shareSuccess = share.isSuccess;
  const shareError = share.error ? classifyQueryError(share.error).message : "";

  // Years the building has energy for (annual + series, both scenarios), so a
  // single year-share grants every dataset for that year. getEnergyDataUrls then
  // filters the building's cons:hasEnergyDataset links by this selection.
  const availableYears = useMemo(
    () =>
      [...new Set((building.energyDatasets ?? []).map((d) => d.year))]
        .sort((a, b) => a - b),
    [building.energyDatasets],
  );

  // Conditionally mounted per building (ManagePage gates on state), so closing
  // unmounts the dialog and React discards all of the state above — no manual
  // reset on close needed.
  const handleProceedToConfirm = async () => {
    if (shareMode === "webid") {
      if (webIds.length === 0) {
        setWebIdError("Enter at least one WebID");
        return;
      }
      const invalid = webIds.filter((r) => {
        try {
          new URL(r);
          return false;
        } catch (err) {
          logError("validate share recipient WebID", err);
          return true;
        }
      });
      if (invalid.length > 0) {
        setWebIdError(
          `Invalid WebID${invalid.length > 1 ? "s" : ""}: ${
            invalid.join(", ")
          }`,
        );
        return;
      }
      // Sharing to yourself is a no-op with a cost: it appends a permanently
      // active grant to shared-out/ (the revoke's removeFromACL self-no-ops, so
      // the pair can never fold away) and posts a pointless self-notification.
      // The role path already excludes self (getMembersByRole).
      if (webIds.includes(session.info.webId ?? "")) {
        setWebIdError("You cannot share a building with yourself");
        return;
      }
      setWebIdError("");
      setRecipients(webIds);
      setConfirmStep(true);
      return;
    }

    // Role mode: resolve the chosen role to member WebIDs via the data room.
    if (!targetRole) {
      setWebIdError("Select a role");
      return;
    }
    setResolving(true);
    setWebIdError("");
    try {
      const resolved = await getMembersByRole(
        getActiveRoom(),
        targetRole,
        session,
      );
      if (resolved.length === 0) {
        setWebIdError(
          "No data room members currently hold that role.",
        );
        return;
      }
      setRecipients(resolved);
      setConfirmStep(true);
    } catch (error) {
      setWebIdError(
        `Could not load data room members: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      setResolving(false);
    }
  };

  const handleShare = () =>
    share.mutate(
      {
        buildingUri,
        recipients,
        includeEnergyData: shareScope !== "static",
        years: shareScope === "years" ? selectedYears : undefined,
      },
      {
        onSuccess: () =>
          showNotification("Building shared successfully", "success"),
        // Back to the form step, where the inline error Alert renders.
        onError: () => setConfirmStep(false),
      },
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      dirty={webIds.length > 0 || recipients.length > 0 || targetRole !== ""}
      busy={sharing}
      title="Share Building Data"
      actions={sharing
        ? undefined
        : shareSuccess
        ? <Button onClick={onClose} variant="contained">Done</Button>
        : !confirmStep
        ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              onClick={handleProceedToConfirm}
              variant="contained"
              disabled={resolving ||
                (shareMode === "webid" ? webIds.length === 0 : !targetRole) ||
                (shareScope === "years" && selectedYears.length === 0)}
            >
              {resolving ? "Resolving…" : "Review & Share"}
            </Button>
          </>
        )
        : (
          <>
            <Button onClick={() => setConfirmStep(false)}>Back</Button>
            <Button onClick={handleShare} variant="contained">
              Confirm Share
            </Button>
          </>
        )}
    >
      {sharing && (
        <Typography variant="body2" color="text.secondary">Sharing…</Typography>
      )}

      {!sharing && shareSuccess && (
        <Alert severity="success">
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 0.5,
            }}
          >
            Shared successfully with{" "}
            {recipients.map((r) => (
              <AgentChip key={r} value={r} size="small" variant="outlined" />
            ))}
          </Box>
        </Alert>
      )}

      {!sharing && !shareSuccess && !confirmStep && (
        <>
            {/* A failed share lands back here — persistent, in-context (the
                Alert carve-out); the hook is silent so there's no double toast. */}
            {shareError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {shareError}
              </Alert>
            )}
            <ToggleButtonGroup
              value={shareMode}
              exclusive
              size="small"
              sx={{ mb: 2 }}
              onChange={(_e, value) => {
                if (value) {
                  setShareMode(value);
                  setWebIdError("");
                }
              }}
            >
              <ToggleButton value="webid">By WebID</ToggleButton>
              <ToggleButton value="role">By role</ToggleButton>
            </ToggleButtonGroup>

            {shareMode === "webid"
              ? (
                <>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2 }}
                  >
                    Choose recipients from your contacts and data room members, or
                    type a WebID and press Enter to add it.
                  </Typography>
                  <Autocomplete
                    multiple
                    freeSolo
                    options={agentOptions}
                    value={webIds}
                    onChange={(_e, value) => {
                      setWebIds(value as string[]);
                      if (webIdError) setWebIdError("");
                    }}
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
                        autoFocus
                        margin="dense"
                        label="Recipient WebID(s)"
                        error={!!webIdError}
                        helperText={webIdError ||
                          "Pick a contact/member, or type a WebID and press Enter"}
                      />
                    )}
                  />
                </>
              )
              : (
                <>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 2 }}
                  >
                    Share with everyone in the GRANERGIZE data room who holds the
                    selected role.
                  </Typography>
                  <FormControl fullWidth error={!!webIdError}>
                    <InputLabel id="share-role-label">Role</InputLabel>
                    <Select
                      labelId="share-role-label"
                      label="Role"
                      value={targetRole}
                      onChange={(e) => {
                        setTargetRole(e.target.value as UserRole);
                        if (webIdError) setWebIdError("");
                      }}
                    >
                      {SHARE_ROLE_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </Select>
                    {webIdError && (
                      <Typography variant="caption" color="error" sx={{ mt: 1 }}>
                        {webIdError}
                      </Typography>
                    )}
                  </FormControl>
                </>
              )}
            <FormControl component="fieldset" sx={{ mt: 3 }}>
              <FormLabel component="legend">What to share</FormLabel>
              <RadioGroup
                value={shareScope}
                onChange={(e) =>
                  setShareScope(e.target.value as ShareScope)}
              >
                <FormControlLabel
                  value="static"
                  control={<Radio />}
                  label="Static building data only"
                />
                <FormControlLabel
                  value="all"
                  control={<Radio />}
                  label="Static building data and all energy readings"
                />
                <FormControlLabel
                  value="years"
                  control={<Radio />}
                  label="Static building data and energy for specific year(s)"
                  disabled={availableYears.length === 0}
                />
              </RadioGroup>
              {shareScope === "years" && (
                availableYears.length === 0
                  ? (
                    <Alert severity="info" sx={{ mt: 1 }}>
                      This building has no energy datasets to share by year.
                    </Alert>
                  )
                  : (
                    <FormGroup sx={{ pl: 4, mt: 1 }}>
                      {availableYears.map((year) => (
                        <FormControlLabel
                          key={year}
                          control={
                            <Checkbox
                              checked={selectedYears.includes(year)}
                              onChange={(e) =>
                                setSelectedYears((prev) =>
                                  e.target.checked
                                    ? [...prev, year]
                                    : prev.filter((y) => y !== year)
                                )}
                            />
                          }
                          label={String(year)}
                        />
                      ))}
                    </FormGroup>
                  )
              )}
            </FormControl>
        </>
      )}

      {!sharing && !shareSuccess && confirmStep && (
        <>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {shareMode === "role"
                ? `Confirm sharing with ${recipients.length} data room member${
                  recipients.length === 1 ? "" : "s"
                }:`
                : "Confirm sharing with:"}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2 }}>
              {recipients.map((r) => (
                <AgentChip key={r} value={r} size="small" variant="outlined" />
              ))}
            </Box>
            <Typography variant="body2">
              <strong>Includes:</strong> {shareScope === "static"
                ? "Static building data only"
                : shareScope === "all"
                ? "Static building data and all energy readings"
                : `Static building data and energy for ${
                  [...selectedYears].sort((a, b) => a - b).join(", ")
                }`}
            </Typography>
        </>
      )}
    </Modal>
  );
}

/** Soft caps — warned, not enforced (Pods have quotas, but we don't hard-block). */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 20;

interface FilesDialogProps {
  open: boolean;
  building: BuildingType;
  session: Session;
  onClose: () => void;
}

/**
 * Manage a building's files: upload arbitrary files (PDF/DOCX/JPG/anything),
 * download, delete, and flag one as the energy certificate. Files live in the
 * building's per-building `files/` container and are shared automatically with
 * anyone the building is shared with (the share grant covers the container).
 *
 * Keeps a local copy of the list so it stays live across uploads/deletes; the
 * mutation hooks invalidate the buildings query so the rest of the app refetches.
 */
export function FilesDialog(
  { open, building, session, onClose }: FilesDialogProps,
) {
  const { showNotification } = useNotification();
  // The building file URI (RMW target) and its RDF subject. attachmentManager
  // strips the fragment for the file URI, so passing the subject is safe too.
  const fileUri = (building.sourceUri as string) ?? building.uri;
  const subjectUri = building.uri;
  // Conditionally mounted per building (ManagePage gates on state), so a fresh
  // initializer from the building's attachments is enough — no effect needed.
  const [items, setItems] = useState<AttachmentRef[]>(
    () => ((building.attachments as AttachmentRef[] | undefined) ?? []).slice(),
  );
  // The writes go through mutation hooks (busy = isPending, error toasts +
  // invalidation central); the download is a READ, so it keeps a local flag.
  const upload = useUploadAttachments();
  const del = useDeleteAttachment();
  const cert = useSetEnergyCertificate();
  const [downloading, setDownloading] = useState(false);
  const busy = upload.isPending || del.isPending || cert.isPending ||
    downloading;

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-selecting the same file
    if (files.length === 0) return;
    if (items.length + files.length > MAX_FILES) {
      showNotification(
        `This building will have more than ${MAX_FILES} files — consider keeping it tidy.`,
        "warning",
      );
    }
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        showNotification(
          `"${file.name}" is large (${
            formatBytes(file.size)
          }); the upload may be slow or rejected by the Pod.`,
          "warning",
        );
      }
    }
    upload.mutate(
      {
        fileUri,
        subjectUri,
        files,
        // Each landed file appears in the list as the batch runs.
        onUploaded: (ref) => setItems((prev) => [...prev, ref]),
      },
    );
  };

  const handleDownload = async (a: AttachmentRef) => {
    setDownloading(true);
    try {
      downloadBlob(await fetchAttachmentBlob(a.url, session), a.filename);
    } catch (error) {
      showNotification(formatError("download the file", error), "error");
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = (a: AttachmentRef) => {
    if (!globalThis.confirm(`Delete "${a.filename}"? This cannot be undone.`)) {
      return;
    }
    del.mutate({ fileUri, subjectUri, url: a.url }, {
      onSuccess: () =>
        setItems((prev) => prev.filter((x) => x.url !== a.url)),
    });
  };

  const handleToggleCert = (a: AttachmentRef) => {
    const makeIt = !a.isEnergyCertificate;
    cert.mutate({ fileUri, subjectUri, url: makeIt ? a.url : null }, {
      onSuccess: () =>
        // Only one file can be the certificate at a time.
        setItems((prev) =>
          prev.map((x) => ({
            ...x,
            isEnergyCertificate: makeIt && x.url === a.url,
          }))
        ),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      title="Files"
      actions={<Button onClick={onClose}>Close</Button>}
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Attach files (PDF, images, documents — anything) to this building. They're
        stored on your Pod and shared automatically with anyone you share the
        building with.
      </Typography>
      {items.length === 0
        ? (
          <Typography variant="body2" sx={{ mb: 2 }}>
            No files yet.
          </Typography>
        )
        : (
          <ul style={listStyle}>
            {items.map((a) => (
              <li key={a.url} style={rowStyle}>
                <span style={{ minWidth: 0 }}>
                  {a.filename}
                  {a.isEnergyCertificate && (
                    <Chip
                      size="small"
                      label="Energy certificate"
                      sx={{ ml: 1 }}
                    />
                  )}
                  <br />
                  <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                  >
                    {a.mediaType}
                    {a.size ? ` · ${formatBytes(a.size)}` : ""}
                  </Typography>
                </span>
                <span style={{ display: "flex", gap: "0.25rem" }}>
                  <Button
                    size="small"
                    onClick={() => handleDownload(a)}
                    disabled={busy}
                  >
                    Download
                  </Button>
                  <Button
                    size="small"
                    onClick={() => handleToggleCert(a)}
                    disabled={busy}
                  >
                    {a.isEnergyCertificate ? "Unset cert" : "Set as cert"}
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => handleDelete(a)}
                    disabled={busy}
                  >
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      <Box mt={1}>
        <input
          type="file"
          multiple
          onChange={handleFiles}
          id="files-input"
          style={{ display: "none" }}
          disabled={busy}
        />
        <label htmlFor="files-input">
          <Button variant="contained" component="span" disabled={busy}>
            {busy ? "Working…" : "Add files"}
          </Button>
        </label>
      </Box>
    </Modal>
  );
}

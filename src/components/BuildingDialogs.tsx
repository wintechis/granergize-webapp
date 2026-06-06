import { useMemo, useState } from "react";
import {
  Alert,
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
import { shareBuildingData } from "../services/interop/share.ts";
import { getActiveRoom, getMembersByRole } from "../services/interop/dataRoom.ts";
import { uploadEnergyCertificate } from "../services/utils/certificateUploader.ts";
import type { BuildingType, UserRole } from "../../types/types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { formatError } from "../services/utils/formatError.ts";

/** Roles selectable as a sharing target (resolved to member WebIDs via the data room). */
const SHARE_ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "investor", label: "Investor" },
  { value: "user", label: "User" },
  { value: "benchmark_service_provider", label: "Benchmark Service Provider" },
];

/** What energy a share grants alongside the always-shared static building data. */
type ShareScope = "static" | "all" | "years";

interface ShareBuildingDialogProps {
  open: boolean;
  buildingUri: string;
  /** The building being shared — its energy datasets drive the per-year picker. */
  building: BuildingType;
  session: Session;
  /** The role under which the building is being shared */
  role?: UserRole | null;
  onClose: () => void;
}

export function ShareBuildingDialog({
  open,
  buildingUri,
  building,
  session,
  role,
  onClose,
}: ShareBuildingDialogProps) {
  const { showNotification } = useNotification();
  const [sharing, setSharing] = useState(false);
  const [shareMode, setShareMode] = useState<"webid" | "role">("webid");
  const [webId, setWebId] = useState("");
  const [targetRole, setTargetRole] = useState<UserRole | "">("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [resolving, setResolving] = useState(false);
  const [shareScope, setShareScope] = useState<ShareScope>("all");
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [webIdError, setWebIdError] = useState("");
  const [shareError, setShareError] = useState("");
  const [confirmStep, setConfirmStep] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);

  // Years the building has energy for (annual + series, both scenarios), so a
  // single year-share grants every dataset for that year. getEnergyDataUrls then
  // filters the building's gran:hasEnergyDataset links by this selection.
  const availableYears = useMemo(
    () =>
      [...new Set((building.energyDatasets ?? []).map((d) => d.year))]
        .sort((a, b) => a - b),
    [building.energyDatasets],
  );

  const handleClose = () => {
    setShareMode("webid");
    setWebId("");
    setTargetRole("");
    setRecipients([]);
    setResolving(false);
    setShareScope("all");
    setSelectedYears([]);
    setWebIdError("");
    setShareError("");
    setConfirmStep(false);
    setShareSuccess(false);
    onClose();
  };

  const parseWebIds = () =>
    webId.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);

  const handleProceedToConfirm = async () => {
    if (shareMode === "webid") {
      const entered = parseWebIds();
      if (entered.length === 0) {
        setWebIdError("Enter at least one WebID");
        return;
      }
      const invalid = entered.filter((r) => {
        try {
          new URL(r);
          return false;
        } catch {
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
      setWebIdError("");
      setRecipients(entered);
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

  const handleShare = async () => {
    setSharing(true);
    setShareError("");
    const includeEnergyData = shareScope !== "static";
    const years = shareScope === "years" ? selectedYears : undefined;
    try {
      for (const recipient of recipients) {
        await shareBuildingData(buildingUri, recipient, session, {
          includeEnergyData,
          years,
          role: role ?? undefined,
        });
      }
      setShareSuccess(true);
      showNotification("Building shared successfully", "success");
    } catch (error) {
      console.error("Error sharing building:", error);
      setShareError(error instanceof Error ? error.message : String(error));
      setConfirmStep(false);
    } finally {
      setSharing(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dirty={webId.trim() !== "" || recipients.length > 0 || targetRole !== ""}
      busy={sharing}
      title="Share Building Data"
      actions={sharing
        ? undefined
        : shareSuccess
        ? <Button onClick={handleClose} variant="contained">Done</Button>
        : !confirmStep
        ? (
          <>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              onClick={handleProceedToConfirm}
              variant="contained"
              disabled={resolving ||
                (shareMode === "webid" ? !webId.trim() : !targetRole) ||
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
          Shared successfully with {recipients.join(", ")}
        </Alert>
      )}

      {!sharing && !shareSuccess && !confirmStep && (
        <>
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
                    Enter the WebID(s) of the recipients. Separate multiple
                    WebIDs with a comma or new line.
                  </Typography>
                  <TextField
                    autoFocus
                    margin="dense"
                    label="Recipient WebID(s)"
                    type="text"
                    fullWidth
                    multiline
                    minRows={2}
                    variant="outlined"
                    value={webId}
                    onChange={(e) => {
                      setWebId((e.target as HTMLInputElement).value);
                      if (webIdError) setWebIdError("");
                    }}
                    error={!!webIdError}
                    helperText={webIdError ||
                      "One WebID per line, or comma-separated"}
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
            {shareError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {shareError}
              </Alert>
            )}
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {shareMode === "role"
                ? `Confirm sharing with ${recipients.length} data room member${
                  recipients.length === 1 ? "" : "s"
                }:`
                : "Confirm sharing with:"}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2 }}>
              {recipients.map((r) => (
                <Chip key={r} label={r} size="small" variant="outlined" />
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

interface EnergyCertificateDialogProps {
  open: boolean;
  buildingUri: string;
  session: Session;
  onClose: () => void;
  onUploadSuccess: () => void;
}

export function EnergyCertificateDialog({
  open,
  buildingUri,
  session,
  onClose,
  onUploadSuccess,
}: EnergyCertificateDialogProps) {
  const { showNotification } = useNotification();
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleClose = () => {
    setSelectedFile(null);
    onClose();
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === "application/pdf") {
      setSelectedFile(file);
    } else {
      showNotification("Please select a valid PDF file", "warning");
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      showNotification("Please select a file first", "warning");
      return;
    }

    setUploading(true);
    try {
      await uploadEnergyCertificate(buildingUri, selectedFile, session);
      showNotification("Certificate uploaded successfully", "success");
      onUploadSuccess();
      handleClose();
    } catch (error) {
      console.error("Error uploading energy certificate:", error);
      showNotification(formatError("upload the certificate", error), "error");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dirty={selectedFile != null}
      busy={uploading}
      title="Upload Energy Certificate"
      actions={!uploading && (
        <>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleUpload}
            variant="contained"
            disabled={!selectedFile}
          >
            Upload
          </Button>
        </>
      )}
    >
      {uploading
        ? (
          <Typography variant="body2" color="text.secondary">Uploading…</Typography>
        )
        : (
          <>
            <p style={{ marginTop: 0 }}>
              Upload a PDF file of the energy certificate for this building.
            </p>
            <Box mt={2}>
              <input
                type="file"
                accept="application/pdf"
                onChange={handleFileSelect}
                id="certificate-file-input"
                style={{ display: "none" }}
              />
              <label htmlFor="certificate-file-input">
                <Button variant="outlined" component="span">
                  Choose File
                </Button>
              </label>
              {selectedFile && (
                <Typography variant="body2" sx={{ mt: 1 }}>
                  Selected: {selectedFile.name}
                </Typography>
              )}
            </Box>
          </>
        )}
    </Modal>
  );
}

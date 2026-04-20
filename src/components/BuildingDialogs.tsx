import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
  Typography,
  CircularProgress,
} from "@mui/material";
import { Session } from "@inrupt/solid-client-authn-browser";
import { shareBuildingData } from "../services/interop/share.ts";
import { uploadEnergyCertificate } from "../services/utils/certificateUploader.ts";
import type { UserRole } from "../../types/types.ts";
import { useNotification } from "../context/NotificationContext.tsx";

interface ShareBuildingDialogProps {
  open: boolean;
  buildingUri: string;
  session: Session;
  /** The role under which the building is being shared */
  role?: UserRole | null;
  onClose: () => void;
}

export function ShareBuildingDialog({
  open,
  buildingUri,
  session,
  role,
  onClose,
}: ShareBuildingDialogProps) {
  const { showNotification } = useNotification();
  const [sharing, setSharing] = useState(false);
  const [webId, setWebId] = useState("");
  const [includeEnergyData, setIncludeEnergyData] = useState(true);
  const [webIdError, setWebIdError] = useState("");
  const [shareError, setShareError] = useState("");
  const [confirmStep, setConfirmStep] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);

  const handleClose = () => {
    setWebId("");
    setIncludeEnergyData(true);
    setWebIdError("");
    setShareError("");
    setConfirmStep(false);
    setShareSuccess(false);
    onClose();
  };

  const getRecipients = () =>
    webId.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);

  const handleProceedToConfirm = () => {
    const recipients = getRecipients();
    if (recipients.length === 0) {
      setWebIdError("Enter at least one WebID");
      return;
    }
    const invalid = recipients.filter((r) => {
      try { new URL(r); return false; } catch { return true; }
    });
    if (invalid.length > 0) {
      setWebIdError(`Invalid WebID${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}`);
      return;
    }
    setWebIdError("");
    setConfirmStep(true);
  };

  const handleShare = async () => {
    const recipients = getRecipients();
    setSharing(true);
    setShareError("");
    try {
      for (const recipient of recipients) {
        await shareBuildingData(buildingUri, recipient, session, {
          includeEnergyData,
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
    <Dialog open={open} onClose={handleClose}>
      <DialogTitle>Share Building Data</DialogTitle>

      {sharing && (
        <Box display="flex" justifyContent="center" alignItems="center" my={4}>
          <CircularProgress />
        </Box>
      )}

      {!sharing && shareSuccess && (
        <>
          <DialogContent>
            <Alert severity="success">
              Shared successfully with {getRecipients().join(", ")}
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClose} variant="contained">Done</Button>
          </DialogActions>
        </>
      )}

      {!sharing && !shareSuccess && !confirmStep && (
        <>
          <DialogContent>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Enter the WebID(s) of the recipients. Separate multiple WebIDs with a comma or new line.
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
              helperText={webIdError || "One WebID per line, or comma-separated"}
            />
            <FormControl component="fieldset" sx={{ mt: 3 }}>
              <FormLabel component="legend">What to share</FormLabel>
              <RadioGroup
                value={includeEnergyData ? "both" : "static"}
                onChange={(e) =>
                  setIncludeEnergyData(e.target.value === "both")
                }
              >
                <FormControlLabel
                  value="static"
                  control={<Radio />}
                  label="Static building data only"
                />
                <FormControlLabel
                  value="both"
                  control={<Radio />}
                  label="Static building data and energy readings"
                />
              </RadioGroup>
            </FormControl>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              onClick={handleProceedToConfirm}
              variant="contained"
              disabled={!webId.trim()}
            >
              Review & Share
            </Button>
          </DialogActions>
        </>
      )}

      {!sharing && !shareSuccess && confirmStep && (
        <>
          <DialogContent>
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
            <Typography variant="body2">
              <strong>Includes:</strong>{" "}
              {includeEnergyData
                ? "Static building data and energy readings"
                : "Static building data only"}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirmStep(false)}>Back</Button>
            <Button onClick={handleShare} variant="contained">
              Confirm Share
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
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
      showNotification(
        `Failed to upload energy certificate: ${error instanceof Error ? error.message : String(error)}`,
        "error"
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogTitle>Upload Energy Certificate</DialogTitle>
      {uploading && (
        <Box
          display="flex"
          justifyContent="center"
          alignItems="center"
          mb={2}
          mt={2}
        >
          <CircularProgress />
        </Box>
      )}
      {!uploading && (
        <>
          <DialogContent>
            <DialogContentText>
              Upload a PDF file of the energy certificate for this building.
            </DialogContentText>
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
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              onClick={handleUpload}
              variant="contained"
              disabled={!selectedFile}
            >
              Upload
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

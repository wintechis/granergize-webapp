import { useState } from "react";
import {
  Box,
  Button,
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

  const handleClose = () => {
    setWebId("");
    setIncludeEnergyData(true);
    onClose();
  };

  const handleShare = async () => {
    setSharing(true);
    try {
      await shareBuildingData(buildingUri, webId, session, {
        includeEnergyData,
        role: role ?? undefined,
      });
      showNotification("Building shared successfully", "success");
      handleClose();
    } catch (error) {
      console.error("Error sharing building:", error);
      showNotification(`Failed to share building: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setSharing(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      PaperProps={{
        component: "form",
      }}
    >
      <DialogTitle>Share Building Data</DialogTitle>
      {sharing && (
        <Box
          display="flex"
          justifyContent="center"
          alignItems="center"
          mb={2}
        >
          <CircularProgress />
        </Box>
      )}
      {!sharing && (
        <>
          <DialogContent>
            <DialogContentText>
              Enter the WebID of the user you want to share the building data
              with.
            </DialogContentText>
            <TextField
              autoFocus
              margin="dense"
              id="webId"
              label="Enter WebID"
              type="text"
              fullWidth
              variant="outlined"
              value={webId}
              onChange={(e) => setWebId((e.target as HTMLInputElement).value)}
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
                  label="Static building data and energy data"
                />
              </RadioGroup>
            </FormControl>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClose}>Cancel</Button>
            <Button onClick={handleShare} variant="contained">
              Share
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

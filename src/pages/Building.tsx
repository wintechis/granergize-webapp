import { useState } from "react";
import { Link } from "react-router-dom";
import { BuildingType } from "../../types/types.ts";
import {
Box,
  Button,
  Card,
  CardActions,
  CardContent,
  CardHeader,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  Radio,
  RadioGroup,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Check as CheckIcon,
  Clear as ClearIcon,
  CorporateFare as CorporateFareIcon,
  Share as ShareIcon,
} from "@mui/icons-material";
import { Session } from "@inrupt/solid-client-authn-browser";
import { shareBuildingData } from "../services/interop/share.ts";
import CircularProgress from "@mui/material/CircularProgress";
import { useSolidData } from "../context/SolidDataContext.tsx";
import { uploadEnergyCertificate } from "../services/utils/certificateUploader.ts";

interface BuildingProps {
  building: BuildingType;
  session: Session;
  onHide: () => void;
}

export default function Building({ building, session, onHide }: BuildingProps) {
  const { reloadData } = useSolidData();
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [energyCertificateUploaderOpen, setEnergyCertificateUploaderOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [webId, setWebId] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [includeEnergyData, setIncludeEnergyData] = useState(true);

  function createAgentLink(uriString: string) {
    const hash = new URL(uriString).hash.replace("#", "");
    return <Link to={`agent/${hash}`}>{hash}</Link>;
  }

  function createTypeLink(uriString: string) {
    const hash = new URL(uriString).hash.replace("#", "");
    return <Link to={uriString}>{hash}</Link>;
  }

  function createCoordinatesLink(lat: number, long: number) {
    return (
      <Link to={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${long}`}>
        {lat}, {long}
      </Link>
    );
  }

  function createNaceLink(naceCode: number) {
    return <Link to={`https://nacecode.de/${naceCode}`}>{naceCode}</Link>;
  }

  function createEnergyCertificateLink(uriString: string) {
    return <Link to={uriString}>pdf</Link>;
  }

  const handleShareDialogOpen = () => {
    setShareDialogOpen(true);
  };

  const handleShareDialogClose = () => {
    setShareDialogOpen(false);
    setWebId("");
    setIncludeEnergyData(true);
  };

  const handleShare = async () => {
    setSharing(true);
    await shareBuildingData(building.uri, webId, session, {
      includeEnergyData,
    });
    setSharing(false);
    handleShareDialogClose();
  };

  const handleEnergyCertificateUploaderOpen = () => {
    setEnergyCertificateUploaderOpen(true);
  }
  
  const handleEnergyCertificateUploaderClose = () => {
    setEnergyCertificateUploaderOpen(false);
    setSelectedFile(null);
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === "application/pdf") {
      setSelectedFile(file);
    } else {
      alert("Please select a valid PDF file");
    }
  }

  const handleUpload = async () => {
    if (!selectedFile) {
      alert("Please select a file first");
      return;
    }

    setUploading(true);
    try {
      await uploadEnergyCertificate(building.uri, selectedFile, session);
      await reloadData();
      handleEnergyCertificateUploaderClose();
    } catch (error) {
      console.error("Error uploading energy certificate:", error);
      alert(`Failed to upload energy certificate: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <Card
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          width: 300,
          zIndex: 1000,
        }}
      >
        <CardHeader
          avatar={<CorporateFareIcon />}
          title={
            <>
              {"Building "}
              {building.id}
            </>
          }
          subheader={
            <>
              {building["streetAddress"]}
              <br />
              {`${
                building["postalCode"]
              } ${building.locality}, ${building.region}`}
            </>
          }
          action={
            <Tooltip title="Share building data">
              <IconButton onClick={handleShareDialogOpen}>
                <ShareIcon />
              </IconButton>
            </Tooltip>
          }
        />
        <CardContent>
          <Typography variant="body1">
            <strong>Customer:</strong>{" "}
            {building.customer && createAgentLink(building.customer)}
          </Typography>
          <Typography variant="body1">
            <strong>Operated By:</strong>{" "}
            {building["operatedBy"] && createAgentLink(building["operatedBy"])}
          </Typography>
          <Typography variant="body1">
            <strong>Type:</strong>{" "}
            {building.type && createTypeLink(building.type)}
          </Typography>
          <Typography variant="body1">
            <strong>Coordinates:</strong> {building.lat && building.long &&
              createCoordinatesLink(building.lat, building.long)}
          </Typography>
          <Typography variant="body1">
            <strong>Building Area:</strong> {building["buildingArea"]} m²
          </Typography>
          <Typography variant="body1">
            <strong>Land Area:</strong> {building["landArea"]} m²
          </Typography>
          <Typography variant="body1">
            <strong>Office Area:</strong> {building["officeArea"]} m²
          </Typography>
          <Typography
            sx={{ display: "flex", alignItems: "center" }}
            variant="body1"
          >
            <strong>Has PV System:</strong>{" "}
            {building["hasPVSystem"] == true ? <CheckIcon /> : <ClearIcon />}
          </Typography>
          <Typography variant="body1">
            <strong>Investor:</strong>{" "}
            {building.investor && createAgentLink(building.investor)}
          </Typography>
          <Typography variant="body1">
            <strong>Year of Construction:</strong>{" "}
            {building["yearOfConstruction"]}
          </Typography>
          <Typography variant="body1">
            <strong>NACE Code:</strong>{" "}
            {building["naceCode"] && createNaceLink(building["naceCode"])}
          </Typography>
          <Typography variant="body1">
            <strong>Energy Certificate:</strong>{" "}
            {building["energyCertificate"] && createEnergyCertificateLink(
              building["energyCertificate"],
            ) || <Link to="#" onClick={handleEnergyCertificateUploaderOpen}>upload</Link>}
          </Typography>
        </CardContent>
        <CardActions>
          <Link to="#" onClick={onHide}>hide</Link>
        </CardActions>
      </Card>

      {/* WebID Share Dialog */}
      <Dialog
        open={shareDialogOpen}
        onClose={handleShareDialogClose}
        PaperProps={{
          component: "form",
        }}
      >
        <DialogTitle>Share Building Data</DialogTitle>
          {sharing && (<>
            <Box
              display="flex"
              justifyContent="center"
              alignItems="center"
              mb={2}
            >
              <CircularProgress />
            </Box>
          </>)}
          {!sharing && (<>
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
                onChange={(e) => setIncludeEnergyData(e.target.value === "both")}
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
            <Button onClick={handleShareDialogClose}>Cancel</Button>
            <Button onClick={handleShare} variant="contained">Share</Button>
          </DialogActions>
          </>)}
      </Dialog>

      {/* Energy Certificate Uploader Dialog */}
      <Dialog
        open={energyCertificateUploaderOpen}
        onClose={handleEnergyCertificateUploaderClose}
      >
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
              <Button onClick={handleEnergyCertificateUploaderClose}>Cancel</Button>
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
    </>
  );
}

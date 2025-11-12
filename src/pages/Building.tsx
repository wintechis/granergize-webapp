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
  IconButton,
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

interface BuildingProps {
  building: BuildingType;
  session: Session;
  onHide: () => void;
}

export default function Building({ building, session, onHide }: BuildingProps) {
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [webId, setWebId] = useState("");

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

  const handleShareDialogOpen = () => {
    setShareDialogOpen(true);
  };

  const handleShareDialogClose = () => {
    setShareDialogOpen(false);
    setWebId("");
  };

  const handleShare = async () => {
    setSharing(true);
    await shareBuildingData(building.uri, webId, session);
    setSharing(false);
    handleShareDialogClose();
  };

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
          </DialogContent>
          <DialogActions>
            <Button onClick={handleShareDialogClose}>Cancel</Button>
            <Button onClick={handleShare} variant="contained">Share</Button>
          </DialogActions>
          </>)}
      </Dialog>
    </>
  );
}

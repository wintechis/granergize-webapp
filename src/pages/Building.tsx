import { useState } from "react";
import { Link } from "react-router-dom";
import { BuildingType } from "../../types/types.ts";
import {
  Card,
  CardActions,
  CardContent,
  CardHeader,
  IconButton,
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
import { useSolidData } from "../context/SolidDataContext.tsx";
import {
  ShareBuildingDialog,
  EnergyCertificateDialog,
} from "../components/BuildingDialogs.tsx";

interface BuildingProps {
  building: BuildingType;
  session: Session;
  onHide: () => void;
}

export default function Building({ building, session, onHide }: BuildingProps) {
  const { reloadData } = useSolidData();
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [energyCertificateUploaderOpen, setEnergyCertificateUploaderOpen] = useState(false);

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
              <IconButton onClick={() => setShareDialogOpen(true)}>
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
            ) || <Link to="#" onClick={() => setEnergyCertificateUploaderOpen(true)}>upload</Link>}
          </Typography>
        </CardContent>
        <CardActions>
          <Link to="#" onClick={onHide}>hide</Link>
        </CardActions>
      </Card>

      <ShareBuildingDialog
        open={shareDialogOpen}
        buildingUri={building.uri}
        session={session}
        onClose={() => setShareDialogOpen(false)}
      />

      <EnergyCertificateDialog
        open={energyCertificateUploaderOpen}
        buildingUri={building.uri}
        session={session}
        onClose={() => setEnergyCertificateUploaderOpen(false)}
        onUploadSuccess={reloadData}
      />
    </>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { BuildingType, InvestorCertification, InvestorOperatingCosts } from "../../types/types.ts";
import {
  Card,
  CardActions,
  CardContent,
  CardHeader,
  Divider,
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
  const { reloadData, role } = useSolidData();
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
        <CardContent sx={{ overflowY: "auto", maxHeight: "60vh" }}>
          {/* Common fields */}
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

          {/* Investor-role fields */}
          {role === "investor" && (
            <>
              <Divider sx={{ my: 1 }} />
              {building["hallArea"] != null && (
                <Typography variant="body1">
                  <strong>Hall Area:</strong> {building["hallArea"]} m²
                </Typography>
              )}
              {building["officeSocialArea"] != null && (
                <Typography variant="body1">
                  <strong>Office & Social Area:</strong> {building["officeSocialArea"]} m²
                </Typography>
              )}
              {building["buildingHeight"] != null && (
                <Typography variant="body1">
                  <strong>Building Height:</strong> {building["buildingHeight"]} m
                </Typography>
              )}
              {building["numberOfLoadingDocks"] != null && (
                <Typography variant="body1">
                  <strong>Loading Docks:</strong> {building["numberOfLoadingDocks"]}
                </Typography>
              )}
              {building["yearOfRenovation"] != null && (
                <Typography variant="body1">
                  <strong>Year of Renovation:</strong> {building["yearOfRenovation"]}
                </Typography>
              )}
              {building["shiftRegime"] && (
                <Typography variant="body1">
                  <strong>Shift Regime:</strong> {building["shiftRegime"]}
                </Typography>
              )}
              {building["tenancyType"] && (
                <Typography variant="body1">
                  <strong>Tenancy Type:</strong> {building["tenancyType"]}
                </Typography>
              )}
              {building["leaseType"] && (
                <Typography variant="body1">
                  <strong>Lease Type:</strong> {building["leaseType"]}
                </Typography>
              )}
              {building["tenantIndustry"] && (
                <Typography variant="body1">
                  <strong>Tenant Industry:</strong> {building["tenantIndustry"]}
                </Typography>
              )}
              {building["indoorTemperatureClass"] && (
                <Typography variant="body1">
                  <strong>Indoor Temperature:</strong> {building["indoorTemperatureClass"]}
                </Typography>
              )}
              {/* Heat generation systems */}
              {(building["hasOilBoiler"] != null ||
                building["hasGasBoiler"] != null ||
                building["hasElectricBoiler"] != null ||
                building["hasHeatPump"] != null ||
                building["hasDistrictHeating"] != null) && (
                <>
                  <Divider sx={{ my: 0.5 }} />
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Heat Generation
                  </Typography>
                  {building["hasDistrictHeating"] != null && (
                    <Typography sx={{ display: "flex", alignItems: "center" }} variant="body1">
                      <strong>District Heating:</strong>{" "}
                      {building["hasDistrictHeating"] ? <CheckIcon fontSize="small" /> : <ClearIcon fontSize="small" />}
                    </Typography>
                  )}
                  {building["hasHeatPump"] != null && (
                    <Typography sx={{ display: "flex", alignItems: "center" }} variant="body1">
                      <strong>Heat Pump:</strong>{" "}
                      {building["hasHeatPump"] ? <CheckIcon fontSize="small" /> : <ClearIcon fontSize="small" />}
                    </Typography>
                  )}
                  {building["hasGasBoiler"] != null && (
                    <Typography sx={{ display: "flex", alignItems: "center" }} variant="body1">
                      <strong>Gas Boiler:</strong>{" "}
                      {building["hasGasBoiler"] ? <CheckIcon fontSize="small" /> : <ClearIcon fontSize="small" />}
                    </Typography>
                  )}
                  {building["hasOilBoiler"] != null && (
                    <Typography sx={{ display: "flex", alignItems: "center" }} variant="body1">
                      <strong>Oil Boiler:</strong>{" "}
                      {building["hasOilBoiler"] ? <CheckIcon fontSize="small" /> : <ClearIcon fontSize="small" />}
                    </Typography>
                  )}
                  {building["hasElectricBoiler"] != null && (
                    <Typography sx={{ display: "flex", alignItems: "center" }} variant="body1">
                      <strong>Electric Boiler:</strong>{" "}
                      {building["hasElectricBoiler"] ? <CheckIcon fontSize="small" /> : <ClearIcon fontSize="small" />}
                    </Typography>
                  )}
                </>
              )}
              {/* Certifications */}
              {Array.isArray(building["certifications"]) &&
                (building["certifications"] as InvestorCertification[]).length > 0 && (
                <>
                  <Divider sx={{ my: 0.5 }} />
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Certifications
                  </Typography>
                  {(building["certifications"] as InvestorCertification[]).map((cert, i) => (
                    <Typography key={i} variant="body1">
                      <strong>{cert.type}:</strong> {cert.level}{cert.scope ? ` (${cert.scope})` : ""}
                    </Typography>
                  ))}
                </>
              )}
              {/* Operating Costs */}
              {building["operatingCosts"] && (
                <>
                  <Divider sx={{ my: 0.5 }} />
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Operating Costs
                  </Typography>
                  {Object.entries(building["operatingCosts"] as InvestorOperatingCosts)
                    .filter(([, v]) => v !== undefined)
                    .map(([k, v]) => (
                      <Typography key={k} sx={{ display: "flex", alignItems: "center" }} variant="body2">
                        <strong style={{ textTransform: "capitalize", marginRight: 4 }}>
                          {k.replace(/([A-Z])/g, " $1").trim()}:
                        </strong>
                        {typeof v === "boolean"
                          ? v ? <CheckIcon fontSize="small" /> : <ClearIcon fontSize="small" />
                          : String(v)}
                      </Typography>
                    ))}
                </>
              )}
            </>
          )}
        </CardContent>
        <CardActions>
          <Link to="#" onClick={onHide}>hide</Link>
        </CardActions>
      </Card>

      <ShareBuildingDialog
        open={shareDialogOpen}
        buildingUri={building.uri}
        session={session}
        role={role}
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

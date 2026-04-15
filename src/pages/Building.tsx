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

  const hasValue = (value: unknown): boolean => {
    if (value == null) {
      return false;
    }
    if (typeof value === "string") {
      return value.trim().length > 0;
    }
    if (typeof value === "number") {
      return !Number.isNaN(value);
    }
    return true;
  };

  const operatingCostEntries = Object.entries((building["operatingCosts"] ?? {}) as InvestorOperatingCosts)
    .filter(([, value]) => hasValue(value));

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
    return (
      <Link to={uriString} target="_blank" rel="noopener noreferrer">
        pdf
      </Link>
    );
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
            !building.isShared && (
              <Tooltip title="Share building data">
                <IconButton onClick={() => setShareDialogOpen(true)}>
                  <ShareIcon />
                </IconButton>
              </Tooltip>
            )
          }
        />
        <CardContent sx={{ overflowY: "auto", maxHeight: "60vh" }}>
          {/* Common fields */}
          {hasValue(building.customer) && (
            <Typography variant="body1">
              <strong>Customer:</strong> {createAgentLink(building.customer as string)}
            </Typography>
          )}
          {hasValue(building.operatedBy) && (
            <Typography variant="body1">
              <strong>Operated By:</strong> {createAgentLink(building.operatedBy as string)}
            </Typography>
          )}
          {hasValue(building.type) && (
            <Typography variant="body1">
              <strong>Type:</strong> {createTypeLink(building.type)}
            </Typography>
          )}
          {building.lat != null && building.long != null && (
            <Typography variant="body1">
              <strong>Coordinates:</strong> {createCoordinatesLink(building.lat, building.long)}
            </Typography>
          )}
          {building.buildingArea != null && (
            <Typography variant="body1">
              <strong>Building Area:</strong> {building.buildingArea} m²
            </Typography>
          )}
          {building.landArea != null && (
            <Typography variant="body1">
              <strong>Land Area:</strong> {building.landArea} m²
            </Typography>
          )}
          {building.officeArea != null && (
            <Typography variant="body1">
              <strong>Office Area:</strong> {building.officeArea} m²
            </Typography>
          )}
          {building.hasPVSystem != null && (
            <Typography sx={{ display: "flex", alignItems: "center" }} variant="body1">
              <strong>Has PV System:</strong>{" "}
              {building.hasPVSystem ? <CheckIcon /> : <ClearIcon />}
            </Typography>
          )}
          {hasValue(building.investor) && (
            <Typography variant="body1">
              <strong>Investor:</strong> {createAgentLink(building.investor as string)}
            </Typography>
          )}
          {building.yearOfConstruction != null && (
            <Typography variant="body1">
              <strong>Year of Construction:</strong> {building.yearOfConstruction}
            </Typography>
          )}
          {building.naceCode != null && (
            <Typography variant="body1">
              <strong>NACE Code:</strong> {createNaceLink(building.naceCode)}
            </Typography>
          )}
          {hasValue(building.energyCertificate) && (
            <Typography variant="body1">
              <strong>Energy Certificate:</strong>{" "}
              {createEnergyCertificateLink(building.energyCertificate as string)}
            </Typography>
          )}

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
              {hasValue(building["shiftRegime"]) && (
                <Typography variant="body1">
                  <strong>Shift Regime:</strong> {building["shiftRegime"]}
                </Typography>
              )}
              {hasValue(building["tenancyType"]) && (
                <Typography variant="body1">
                  <strong>Tenancy Type:</strong> {building["tenancyType"]}
                </Typography>
              )}
              {hasValue(building["leaseType"]) && (
                <Typography variant="body1">
                  <strong>Lease Type:</strong> {building["leaseType"]}
                </Typography>
              )}
              {hasValue(building["tenantIndustry"]) && (
                <Typography variant="body1">
                  <strong>Tenant Industry:</strong> {building["tenantIndustry"]}
                </Typography>
              )}
              {hasValue(building["indoorTemperatureClass"]) && (
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
              {operatingCostEntries.length > 0 && (
                <>
                  <Divider sx={{ my: 0.5 }} />
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    Operating Costs
                  </Typography>
                  {operatingCostEntries.map(([k, v]) => (
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

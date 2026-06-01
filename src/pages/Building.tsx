import { useState } from "react";
import {
  BuildingType,
  InvestorCertification,
  InvestorOperatingCosts,
} from "../../types/types.ts";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import {
  Check as CheckIcon,
  Clear as ClearIcon,
  CorporateFare as CorporateFareIcon,
  Edit as EditIcon,
  Share as ShareIcon,
} from "@mui/icons-material";
import { Session } from "@inrupt/solid-client-authn-browser";
import { useSolidData } from "../context/SolidDataContext.tsx";
import {
  EnergyCertificateDialog,
  ShareBuildingDialog,
} from "../components/BuildingDialogs.tsx";
import EditBuildingDialog from "../components/EditBuildingDialog.tsx";
import {
  DetailCard,
  DetailRow,
  RefLink,
  SectionTitle,
  UriLink,
} from "../components/detail/DetailView.tsx";

interface BuildingProps {
  building: BuildingType;
  session: Session;
  onHide: () => void;
  /** Render inline (e.g. in a side pane) instead of as a floating map overlay. */
  embedded?: boolean;
  /**
   * When set, agent references open in-place via this callback (passing the
   * agent id) instead of navigating to the /agent route. Used by the map's
   * focus-trail so the selected building is not lost.
   */
  onNavigateAgent?: (agentId: string) => void;
  /**
   * Drop the identity header (icon + "Building N" + address) — used when that
   * header is rendered separately above (e.g. above the detail tabs).
   */
  hideHeader?: boolean;
}

export default function Building(
  { building, session, onHide, embedded = false, onNavigateAgent, hideHeader }:
    BuildingProps,
) {
  const { reloadData } = useSolidData();
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [energyCertificateUploaderOpen, setEnergyCertificateUploaderOpen] =
    useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

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

  const operatingCostEntries = Object.entries(
    (building["operatingCosts"] ?? {}) as InvestorOperatingCosts,
  )
    .filter(([, value]) => hasValue(value));

  function createAgentLink(uriString: string) {
    const hash = new URL(uriString).hash.replace("#", "");
    if (onNavigateAgent) {
      return <RefLink onClick={() => onNavigateAgent(hash)}>{hash}</RefLink>;
    }
    return <RefLink to={`agent/${hash}`}>{hash}</RefLink>;
  }

  function createTypeLink(uriString: string) {
    const hash = new URL(uriString).hash.replace("#", "");
    return <UriLink href={uriString}>{hash}</UriLink>;
  }

  function createCoordinatesLink(lat: number, long: number) {
    return (
      <UriLink href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${long}`}>
        {lat}, {long}
      </UriLink>
    );
  }

  function createNaceLink(naceCode: number) {
    return <UriLink href={`https://nacecode.de/${naceCode}`}>{naceCode}</UriLink>;
  }

  function createEnergyCertificateLink(uriString: string) {
    return <UriLink href={uriString}>pdf</UriLink>;
  }

  const boolIcon = (v: boolean) =>
    v ? <CheckIcon fontSize="small" /> : <ClearIcon fontSize="small" />;

  // Edit / Share controls (owned buildings only). Shown in the card header
  // normally; when the header is hidden they move to a compact body row so the
  // tab doesn't open with an empty header's worth of whitespace.
  const actions = building.isShared ? null : (
    <Box sx={{ display: "flex" }}>
      <Tooltip title="Edit building">
        <IconButton
          aria-label="Edit building"
          onClick={() => setEditDialogOpen(true)}
        >
          <EditIcon />
        </IconButton>
      </Tooltip>
      <Tooltip title="Share building data">
        <IconButton
          aria-label="Share building data"
          onClick={() => setShareDialogOpen(true)}
        >
          <ShareIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );

  return (
    <>
      <DetailCard
        icon={hideHeader ? undefined : <CorporateFareIcon />}
        title={hideHeader ? undefined : `Building ${building.id}`}
        subheader={hideHeader ? undefined : (
          <>
            {building["streetAddress"]}
            <br />
            {`${
              building["postalCode"]
            } ${building.locality}, ${building.region}`}
          </>
        )}
        action={hideHeader ? undefined : actions}
        sx={embedded ? { width: "100%" } : {
          position: "absolute",
          top: 16,
          right: 16,
          width: 300,
          zIndex: 1000,
        }}
        contentSx={embedded ? undefined : { overflowY: "auto", maxHeight: "60vh" }}
      >
        {hideHeader && actions && (
          <Box sx={{ display: "flex", justifyContent: "flex-end", mb: -1 }}>
            {actions}
          </Box>
        )}
        {/* Building IRI, shown prominently. In the map pane the identity header
            (incl. the URI) is rendered above by Map.tsx, so only show it here in
            the standalone card. */}
        {!hideHeader && (
          <Typography variant="body1" sx={{ mb: 1, wordBreak: "break-all" }}>
            <UriLink href={building.uri}>{building.uri}</UriLink>
          </Typography>
        )}
        {hasValue(building.sourceUri) && (
          <DetailRow
            label="Source"
            value={
              <UriLink href={building.sourceUri as string}>
                {building.sourceUri}
              </UriLink>
            }
          />
        )}
        {/* Common fields */}
        {hasValue(building.customer) && (
          <DetailRow
            label="Customer"
            value={createAgentLink(building.customer as string)}
          />
        )}
        {hasValue(building.operatedBy) && (
          <DetailRow
            label="Operated By"
            value={createAgentLink(building.operatedBy as string)}
          />
        )}
        {hasValue(building.type) && (
          <DetailRow label="Type" value={createTypeLink(building.type)} />
        )}
        {building.lat != null && building.long != null && (
          <DetailRow
            label="Coordinates"
            value={createCoordinatesLink(building.lat, building.long)}
          />
        )}
        {building.buildingArea != null && (
          <DetailRow label="Building Area" value={`${building.buildingArea} m²`} />
        )}
        {building.landArea != null && (
          <DetailRow label="Land Area" value={`${building.landArea} m²`} />
        )}
        {building.officeArea != null && (
          <DetailRow label="Office Area" value={`${building.officeArea} m²`} />
        )}
        {building.hasPVSystem != null && (
          <DetailRow label="Has PV System" value={boolIcon(building.hasPVSystem)} />
        )}
        {hasValue(building.investor) && (
          <DetailRow
            label="Investor"
            value={createAgentLink(building.investor as string)}
          />
        )}
        {building.yearOfConstruction != null && (
          <DetailRow
            label="Year of Construction"
            value={building.yearOfConstruction}
          />
        )}
        {building.naceCode != null && (
          <DetailRow
            label="NACE Code"
            value={createNaceLink(building.naceCode)}
          />
        )}
        {hasValue(building.energyCertificate) && (
          <DetailRow
            label="Energy Certificate"
            value={createEnergyCertificateLink(
              building.energyCertificate as string,
            )}
          />
        )}

        {/* Investor-role fields */}
        {building.sourceRole === "investor" && (
          <>
            <SectionTitle divider>Building</SectionTitle>
            {building["hallArea"] != null && (
              <DetailRow label="Hall Area" value={`${building["hallArea"]} m²`} />
            )}
            {building["officeSocialArea"] != null && (
              <DetailRow
                label="Office & Social Area"
                value={`${building["officeSocialArea"]} m²`}
              />
            )}
            {building["buildingHeight"] != null && (
              <DetailRow
                label="Building Height"
                value={`${building["buildingHeight"]} m`}
              />
            )}
            {building["numberOfLoadingDocks"] != null && (
              <DetailRow
                label="Loading Docks"
                value={building["numberOfLoadingDocks"]}
              />
            )}
            {building["yearOfRenovation"] != null && (
              <DetailRow
                label="Year of Renovation"
                value={building["yearOfRenovation"]}
              />
            )}
            {hasValue(building["shiftRegime"]) && (
              <DetailRow label="Shift Regime" value={building["shiftRegime"]} />
            )}
            {hasValue(building["tenancyType"]) && (
              <DetailRow label="Tenancy Type" value={building["tenancyType"]} />
            )}
            {hasValue(building["leaseType"]) && (
              <DetailRow label="Lease Type" value={building["leaseType"]} />
            )}
            {hasValue(building["tenantIndustry"]) && (
              <DetailRow
                label="Tenant Industry"
                value={building["tenantIndustry"]}
              />
            )}
            {hasValue(building["indoorTemperatureClass"]) && (
              <DetailRow
                label="Indoor Temperature"
                value={building["indoorTemperatureClass"]}
              />
            )}
            {/* Heat generation systems */}
            {(building["hasOilBoiler"] != null ||
              building["hasGasBoiler"] != null ||
              building["hasElectricBoiler"] != null ||
              building["hasHeatPump"] != null ||
              building["hasDistrictHeating"] != null) && (
              <>
                <SectionTitle divider>Heat Generation</SectionTitle>
                {building["hasDistrictHeating"] != null && (
                  <DetailRow
                    label="District Heating"
                    value={boolIcon(building["hasDistrictHeating"])}
                  />
                )}
                {building["hasHeatPump"] != null && (
                  <DetailRow
                    label="Heat Pump"
                    value={boolIcon(building["hasHeatPump"])}
                  />
                )}
                {building["hasGasBoiler"] != null && (
                  <DetailRow
                    label="Gas Boiler"
                    value={boolIcon(building["hasGasBoiler"])}
                  />
                )}
                {building["hasOilBoiler"] != null && (
                  <DetailRow
                    label="Oil Boiler"
                    value={boolIcon(building["hasOilBoiler"])}
                  />
                )}
                {building["hasElectricBoiler"] != null && (
                  <DetailRow
                    label="Electric Boiler"
                    value={boolIcon(building["hasElectricBoiler"])}
                  />
                )}
              </>
            )}
            {/* Certifications */}
            {Array.isArray(building["certifications"]) &&
              (building["certifications"] as InvestorCertification[]).length >
                0 &&
              (
                <>
                  <SectionTitle divider>Certifications</SectionTitle>
                  {(building["certifications"] as InvestorCertification[])
                    .map((cert, i) => (
                      <DetailRow
                        key={i}
                        label={cert.type}
                        value={`${cert.level}${
                          cert.scope ? ` (${cert.scope})` : ""
                        }`}
                      />
                    ))}
                </>
              )}
            {/* Operating Costs */}
            {operatingCostEntries.length > 0 && (
              <>
                <SectionTitle divider>Operating Costs</SectionTitle>
                {operatingCostEntries.map(([k, v]) => (
                  <DetailRow
                    key={k}
                    dense
                    label={
                      <span style={{ textTransform: "capitalize" }}>
                        {k.replace(/([A-Z])/g, " $1").trim()}
                      </span>
                    }
                    value={typeof v === "boolean" ? boolIcon(v) : String(v)}
                  />
                ))}
              </>
            )}
          </>
        )}
        {!embedded && <RefLink onClick={onHide}>hide</RefLink>}
      </DetailCard>

      {!building.isShared && (
        <EditBuildingDialog
          key={building.uri as string}
          open={editDialogOpen}
          building={building}
          session={session}
          onClose={() => setEditDialogOpen(false)}
          onBuildingUpdated={reloadData}
        />
      )}

      <ShareBuildingDialog
        open={shareDialogOpen}
        buildingUri={building.sourceUri ?? building.uri}
        session={session}
        role={building.sourceRole}
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

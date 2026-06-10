import {
  BuildingType,
  InvestorCertification,
  InvestorOperatingCosts,
} from "../types.ts";
import { Typography } from "@mui/material";
import {
  Check as CheckIcon,
  Clear as ClearIcon,
  CorporateFare as CorporateFareIcon,
} from "@mui/icons-material";
import {
  DetailCard,
  DetailRow,
  RefLink,
  SectionTitle,
  UriLink,
} from "../components/detail/DetailView.tsx";
import FilesSection from "../components/detail/FilesSection.tsx";
import { AgentLabel } from "../components/AgentLabel.tsx";
import { useDevMode } from "../hooks/devMode.ts";

interface BuildingProps {
  building: BuildingType;
  onHide: () => void;
  /** Render inline (e.g. in a side pane) instead of as a floating map overlay. */
  embedded?: boolean;
  /**
   * Drop the identity header (icon + "Building N" + address) — used when that
   * header is rendered separately above (e.g. above the detail tabs).
   */
  hideHeader?: boolean;
}

export default function Building(
  { building, onHide, embedded = false, hideHeader }: BuildingProps,
) {
  // Raw storage IRIs (the building resource + its source file) are a
  // Developer-mode affordance, like every other backing-resource link.
  const dev = useDevMode();
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

  // Whether any investor-vocab detail is present — drives the "Building" section
  // by data, not role (a building from any source that carries these shows them).
  const INVESTOR_DETAIL_FIELDS = [
    "hallArea",
    "officeSocialArea",
    "buildingHeight",
    "numberOfLoadingDocks",
    "yearOfRenovation",
    "shiftRegime",
    "tenancyType",
    "leaseType",
    "tenantIndustry",
    "indoorTemperatureClass",
    "hasOilBoiler",
    "hasGasBoiler",
    "hasElectricBoiler",
    "hasHeatPump",
    "hasDistrictHeating",
  ] as const;
  const hasInvestorDetails = INVESTOR_DETAIL_FIELDS.some((f) =>
    building[f] != null
  ) ||
    (Array.isArray(building["certifications"]) &&
      building["certifications"].length > 0) ||
    operatingCostEntries.length > 0;

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

  function createNaceLink(naceCode: string) {
    return <UriLink href={`https://nacecode.de/${naceCode}`}>{naceCode}</UriLink>;
  }

  const boolIcon = (v: boolean) =>
    v ? <CheckIcon fontSize="small" /> : <ClearIcon fontSize="small" />;

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
        sx={{ width: "100%" }}
      >
        {/* Building IRI (standalone card only — in the map pane the identity
            header is rendered above by ExplorePage.tsx) and the backing source
            file: raw storage IRIs, so Developer mode only. */}
        {dev && !hideHeader && (
          <Typography variant="body1" sx={{ mb: 1, wordBreak: "break-all" }}>
            <UriLink href={building.uri}>{building.uri}</UriLink>
          </Typography>
        )}
        {dev && hasValue(building.sourceUri) && (
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
            value={<AgentLabel value={building.customer as string} />}
          />
        )}
        {hasValue(building.operatedBy) && (
          <DetailRow
            label="Operated By"
            value={<AgentLabel value={building.operatedBy as string} />}
          />
        )}
        {hasValue(building.ownedBy) && (
          <DetailRow
            label="Owned By"
            value={<AgentLabel value={building.ownedBy as string} />}
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
            value={<AgentLabel value={building.investor as string} />}
          />
        )}
        {hasValue(building.facilityManagedBy) && (
          <DetailRow
            label="Facility Manager"
            value={<AgentLabel value={building.facilityManagedBy as string} />}
          />
        )}
        {hasValue(building.developedBy) && (
          <DetailRow
            label="Developed By"
            value={<AgentLabel value={building.developedBy as string} />}
          />
        )}
        {hasValue(building.consultedBy) && (
          <DetailRow
            label="Consultant / Broker"
            value={<AgentLabel value={building.consultedBy as string} />}
          />
        )}
        {hasValue(building.attributedTo) && (
          <DetailRow
            label="Data source"
            value={<AgentLabel value={building.attributedTo as string} />}
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
        {/* Files (attachments + energy certificate) — download via the authed
            session; works for both the owner and a share recipient. Per-year
            energy entry and file upload are write actions and live on MANAGE. */}
        <FilesSection building={building} />

        {/* Investor-vocab fields — shown whenever present (predicate-driven, not
            role-gated), so any building carrying them renders them. */}
        {hasInvestorDetails && (
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
        {!embedded && <RefLink onClick={onHide}>← Back</RefLink>}
      </DetailCard>
    </>
  );
}

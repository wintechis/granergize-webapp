import { Button } from "@mui/material";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import type { BuildingFieldHelpers } from "./buildingFields.tsx";
import { AgentField } from "./AgentField.tsx";

/**
 * The Address / Location & Physical / agent-link block shared by the Add and
 * Edit dialogs — ONE rendering, so the two dialogs can't drift on this set
 * (the original heike-3 complaint was exactly such drift, in copy-pasted
 * blocks). Renders above {@link BuildingDetailFields}.
 */
export function BuildingAddressFields(
  { f, fields, setField, isRequired, geocode }: {
    f: BuildingFieldHelpers;
    fields: Record<string, string>;
    setField: (key: string, val: string) => void;
    /** Whether a field is required (both dialogs require ADDRESS_FIELDS). */
    isRequired: (field: string) => boolean;
    /** The geocode affordance — label and enablement differ per dialog. */
    geocode: {
      // Wired to a Button's onClick (an async handler is fine — it self-handles
      // and its return is ignored), so the type admits a promise.
      onClick: () => void | Promise<void>;
      busy: boolean;
      disabled?: boolean;
      label: string;
    };
  },
) {
  const { tf, check, sectionHeader } = f;
  return (
    <>
      {sectionHeader("Address")}
      {tf("Street address", "streetAddress", { required: isRequired("streetAddress") })}
      {tf("Locality (city)", "locality", { required: isRequired("locality") })}
      {tf("Postal code", "postalCode", { required: isRequired("postalCode") })}
      {tf("Region (state)", "region", { required: isRequired("region") })}

      {sectionHeader("Location and Physical")}
      <Button
        variant="outlined"
        startIcon={<MyLocationIcon />}
        onClick={geocode.onClick}
        disabled={geocode.busy || geocode.disabled}
        sx={{ mb: 1.5 }}
      >
        {geocode.busy ? "Looking up…" : geocode.label}
      </Button>
      {tf("Latitude", "lat", { type: "number", required: isRequired("lat") })}
      {tf("Longitude", "long", { type: "number", required: isRequired("long") })}
      {tf("Building area (m²)", "buildingArea", { type: "number" })}
      {tf("Land area (m²)", "landArea", { type: "number" })}
      {tf("Year of construction", "yearOfConstruction", { type: "number" })}
      <AgentField
        label="Operated by (WebID)"
        value={fields.operatedBy ?? ""}
        onChange={(v) => setField("operatedBy", v)}
      />
      <AgentField
        label="Owned by (WebID)"
        value={fields.ownedBy ?? ""}
        onChange={(v) => setField("ownedBy", v)}
      />
      <AgentField
        label="Investor (WebID)"
        value={fields.investor ?? ""}
        onChange={(v) => setField("investor", v)}
      />
      <AgentField
        label="Facility manager (WebID)"
        value={fields.facilityManagedBy ?? ""}
        onChange={(v) => setField("facilityManagedBy", v)}
      />
      <AgentField
        label="Developed by (WebID)"
        value={fields.developedBy ?? ""}
        onChange={(v) => setField("developedBy", v)}
      />
      <AgentField
        label="Consultant / broker (WebID)"
        value={fields.consultedBy ?? ""}
        onChange={(v) => setField("consultedBy", v)}
      />
      {check("PV system installed", "hasPVSystem")}
    </>
  );
}

/**
 * The building master-data fields shared by the Add and Edit dialogs, rendered
 * unconditionally (no per-role/template gating) so the two dialogs always offer the
 * same set — every field offered at Add stays editable afterwards (heike-3 #1–3).
 * This is the union of the former investor and BSP field sets; energy figures are
 * entered separately (the per-year Energy dialog), and the Edit dialog adds the
 * structured Operating-costs / Certifications sections below this.
 */
export function BuildingDetailFields(
  { f, buildingCode }: {
    f: BuildingFieldHelpers;
    /** Optional error/helperText for the building-code field (Add's duplicate check). */
    buildingCode?: { error?: boolean; helperText?: string };
  },
) {
  const { tf, check, enumSelect, sectionHeader } = f;
  return (
    <>
      {sectionHeader("Building details")}
      {tf("Building code", "buildingCode", buildingCode)}
      {tf("Label / name", "label")}
      {tf("Company name", "companyName")}
      {tf("Hall area (m²)", "hallArea", { type: "number" })}
      {tf("Office and social area (m²)", "officeSocialArea", { type: "number" })}
      {tf("Building height (m)", "buildingHeight", { type: "number" })}
      {tf("Number of loading docks", "numberOfLoadingDocks", { type: "number" })}
      {tf("Year of renovation", "yearOfRenovation", { type: "number" })}
      {tf("Lease type", "leaseType")}
      {tf("Tenant industry", "tenantIndustry")}
      {tf("Logistics function", "logisticsFunction")}
      {tf("Climate control type", "climateControlType")}
      {tf("Green lease share (%)", "greenLeaseShare", { type: "number" })}
      {tf("PV installation year", "pvInstallationYear", { type: "number" })}
      {tf("PV capacity (kW)", "pvCapacityKW", { type: "number" })}
      {enumSelect("Shift regime", "shiftRegime", [
        { value: "OneShift", label: "1-Shift" },
        { value: "TwoShift", label: "2-Shift" },
        { value: "ThreeShift", label: "3-Shift" },
      ])}
      {enumSelect("Tenancy type", "tenancyType", [
        { value: "SingleTenant", label: "Single Tenant" },
        { value: "MultiTenant", label: "Multi Tenant" },
      ])}
      {enumSelect("Indoor temperature class", "indoorTemperatureClass", [
        { value: "MaxTwelveDegrees", label: "≤12 °C" },
        { value: "MaxEighteenDegrees", label: "≤18 °C" },
      ])}
      {sectionHeader("Heating systems")}
      {check("Oil boiler", "hasOilBoiler")}
      {check("Gas boiler", "hasGasBoiler")}
      {check("Electric boiler", "hasElectricBoiler")}
      {check("Heat pump", "hasHeatPump")}
      {check("District heating", "hasDistrictHeating")}
    </>
  );
}

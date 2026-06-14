import { Button } from "@mui/material";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import type { BuildingFieldHelpers } from "./buildingFields.tsx";
import { AgentField } from "./AgentField.tsx";
import { fieldLabel, optionLabel } from "../services/rdf/vocabLabels.ts";
import { BUILDING_NS } from "../services/rdf/vocabularies.ts";

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
      {tf(fieldLabel("buildingArea"), "buildingArea", { type: "number" })}
      {tf(fieldLabel("landArea"), "landArea", { type: "number" })}
      {tf(fieldLabel("yearOfConstruction"), "yearOfConstruction", { type: "number" })}
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
      {check(fieldLabel("hasPVSystem"), "hasPVSystem")}
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
      {tf(fieldLabel("buildingCode"), "buildingCode", buildingCode)}
      {tf("Label / name", "label")}
      {tf(fieldLabel("companyName"), "companyName")}
      {tf(fieldLabel("hallArea"), "hallArea", { type: "number" })}
      {tf(fieldLabel("officeSocialArea"), "officeSocialArea", { type: "number" })}
      {tf(fieldLabel("buildingHeight"), "buildingHeight", { type: "number" })}
      {tf(fieldLabel("numberOfLoadingDocks"), "numberOfLoadingDocks", { type: "number" })}
      {tf(fieldLabel("yearOfRenovation"), "yearOfRenovation", { type: "number" })}
      {tf(fieldLabel("leaseType"), "leaseType")}
      {tf(fieldLabel("tenantIndustry"), "tenantIndustry")}
      {tf(fieldLabel("logisticsFunction"), "logisticsFunction")}
      {tf(fieldLabel("climateControlType"), "climateControlType")}
      {tf(fieldLabel("greenLeaseShare"), "greenLeaseShare", { type: "number" })}
      {tf(fieldLabel("pvInstallationYear"), "pvInstallationYear", { type: "number" })}
      {tf(fieldLabel("pvCapacityKW"), "pvCapacityKW", { type: "number" })}
      {enumSelect(fieldLabel("shiftRegime"), "shiftRegime", [
        { value: "OneShift", label: optionLabel(`${BUILDING_NS}OneShift`) },
        { value: "TwoShift", label: optionLabel(`${BUILDING_NS}TwoShift`) },
        { value: "ThreeShift", label: optionLabel(`${BUILDING_NS}ThreeShift`) },
      ])}
      {enumSelect(fieldLabel("tenancyType"), "tenancyType", [
        { value: "SingleTenant", label: optionLabel(`${BUILDING_NS}SingleTenant`) },
        { value: "MultiTenant", label: optionLabel(`${BUILDING_NS}MultiTenant`) },
      ])}
      {enumSelect(fieldLabel("indoorTemperatureClass"), "indoorTemperatureClass", [
        { value: "MaxTwelveDegrees", label: optionLabel(`${BUILDING_NS}MaxTwelveDegrees`) },
        { value: "MaxEighteenDegrees", label: optionLabel(`${BUILDING_NS}MaxEighteenDegrees`) },
      ])}
      {sectionHeader("Heating systems")}
      {check(fieldLabel("hasOilBoiler"), "hasOilBoiler")}
      {check(fieldLabel("hasGasBoiler"), "hasGasBoiler")}
      {check(fieldLabel("hasElectricBoiler"), "hasElectricBoiler")}
      {check(fieldLabel("hasHeatPump"), "hasHeatPump")}
      {check(fieldLabel("hasDistrictHeating"), "hasDistrictHeating")}
    </>
  );
}

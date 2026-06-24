import { msg } from "../lib/messages.ts";
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
  { f, fields, setField, isRequired, geocode, basicsOnly }: {
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
    /** Create form: render only the BASICS — address + coordinates. All the rest of the
     *  master data (areas, every agent incl. the operator, and all of
     *  {@link BuildingDetailFields}) is added inline on the building page afterward. */
    basicsOnly?: boolean;
  },
) {
  const { tf, sectionHeader } = f;
  return (
    <>
      {sectionHeader(msg("secAddress"))}
      {tf(msg("lblStreetAddress"), "streetAddress", { required: isRequired("streetAddress") })}
      {tf(msg("lblLocality"), "locality", { required: isRequired("locality") })}
      {tf(msg("lblPostalCode"), "postalCode", { required: isRequired("postalCode") })}
      {tf(msg("lblRegion"), "region", { required: isRequired("region") })}

      {sectionHeader(msg("secLocationPhysical"))}
      <Button
        variant="outlined"
        startIcon={<MyLocationIcon />}
        onClick={geocode.onClick}
        disabled={geocode.busy || geocode.disabled}
        sx={{ mb: 1.5 }}
      >
        {geocode.busy ? "Looking up…" : geocode.label}
      </Button>
      {tf(msg("lblLatitude"), "lat", { type: "number", required: isRequired("lat") })}
      {tf(msg("lblLongitude"), "long", { type: "number", required: isRequired("long") })}
      {!basicsOnly && (
        <>
          {tf(fieldLabel("buildingArea"), "buildingArea", { type: "number" })}
          {tf(fieldLabel("landArea"), "landArea", { type: "number" })}
          {tf(fieldLabel("yearOfConstruction"), "yearOfConstruction", { type: "number" })}
          <AgentField
            label={msg("lblOperatedBy")}
            value={fields.operatedBy ?? ""}
            onChange={(v) => setField("operatedBy", v)}
          />
          <AgentField
            label={msg("lblOwnedBy")}
            value={fields.ownedBy ?? ""}
            onChange={(v) => setField("ownedBy", v)}
          />
          <AgentField
            label={msg("lblInvestor")}
            value={fields.investor ?? ""}
            onChange={(v) => setField("investor", v)}
          />
          <AgentField
            label={msg("lblFacilityManager")}
            value={fields.facilityManagedBy ?? ""}
            onChange={(v) => setField("facilityManagedBy", v)}
          />
          <AgentField
            label={msg("lblDevelopedBy")}
            value={fields.developedBy ?? ""}
            onChange={(v) => setField("developedBy", v)}
          />
          <AgentField
            label={msg("lblConsultant")}
            value={fields.consultedBy ?? ""}
            onChange={(v) => setField("consultedBy", v)}
          />
        </>
      )}
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
  const { tf, enumSelect, sectionHeader } = f;
  return (
    <>
      {sectionHeader(msg("secBuildingDetails"))}
      {tf(fieldLabel("buildingCode"), "buildingCode", buildingCode)}
      {tf(msg("lblLabelName"), "label")}
      {tf(fieldLabel("companyName"), "companyName")}
      {tf(msg("mdCustomer"), "customer")}
      {tf(msg("mdNaceCode"), "naceCode")}
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
      {/* Technical systems (PV / battery / CHP and the heat generators, all bldg:hasSystem
          nodes) are NOT here — they're added/edited on the building page via the Energy
          systems / Heat generation sections, not while creating the building. */}
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
      {/* Heat generators (heat pump / boilers / district heating) are NOT here — like PV /
          battery / CHP they're :TechnicalSystem nodes, added/edited on the building page in
          the "Heat generation" section with thermal capacity + commissioning year. */}
    </>
  );
}

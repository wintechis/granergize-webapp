import type { BuildingFieldHelpers } from "./buildingFields.tsx";

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
      {tf("Office & social area (m²)", "officeSocialArea", { type: "number" })}
      {tf("Building height (m)", "buildingHeight", { type: "number" })}
      {tf("Number of loading docks", "numberOfLoadingDocks", { type: "number" })}
      {tf("Year of renovation", "yearOfRenovation", { type: "number" })}
      {tf("Lease type", "leaseType")}
      {tf("Tenant industry", "tenantIndustry")}
      {tf("Logistics function", "logisticsFunction")}
      {tf("Climate control type", "climateControlType")}
      {tf("Indoor temperature", "indoorTemperature")}
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

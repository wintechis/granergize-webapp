import { useMemo, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import { Session } from "@inrupt/solid-client-authn-browser";
import type {
  BuildingType,
  InvestorCertification,
  InvestorOperatingCosts,
} from "../types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { investorLocalNameLabels } from "../services/utils/config/buildingConfig.ts";
import {
  geocodeFields,
  updateBuilding,
} from "../services/utils/buildingSerializer.ts";
import { formatError } from "../services/utils/formatError.ts";
import { rememberAgent } from "../services/utils/contacts.ts";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../hooks/queries.ts";
import { makeBuildingFields } from "./buildingFields.tsx";
import { AgentField } from "./AgentField.tsx";
import Modal from "./Modal.tsx";

interface EditBuildingDialogProps {
  open: boolean;
  building: BuildingType;
  session: Session;
  onClose: () => void;
  onBuildingUpdated: () => void;
}

const SKIP_FIELDS = new Set([
  "id",
  "uri",
  "sourceUri",
  "provenance",
  "attributedTo",
  "isShared",
  "energyData",
  "certifications",
  "annualData",
  "operatingCosts",
  "customer",
  "investor",
  "type",
  "naceCode",
  "energyCertificate",
]);

// Reverse map: human-readable label → local name (e.g. "1-Shift" → "OneShift")
const labelToLocalName: Record<string, string> = Object.fromEntries(
  Object.entries(investorLocalNameLabels).map(([ln, label]) => [label, ln]),
);

const ENUM_FIELDS = new Set(["shiftRegime", "tenancyType", "indoorTemperatureClass"]);

// Investor operating-cost categories (mirrors OPCOST_FIELDS in buildingSerializer);
// edited as `_opcost_<key>`. One boolean, the rest free-text currency values.
const OPCOST_FIELDS: { key: string; label: string; bool?: boolean }[] = [
  { key: "wasteDisposal", label: "Waste disposal" },
  { key: "insurance", label: "Insurance" },
  {
    key: "operationInspectionAndMaintenance",
    label: "Operation, inspection & maintenance",
    bool: true,
  },
  { key: "routineCleaningOffice", label: "Routine cleaning (office)" },
  { key: "routineCleaningWarehouse", label: "Routine cleaning (warehouse)" },
  { key: "glassCleaning", label: "Glass cleaning" },
  { key: "exteriorMaintenance", label: "Exterior maintenance" },
  { key: "security", label: "Security" },
  { key: "propertyManagement", label: "Property management" },
  { key: "caretaker", label: "Caretaker" },
  { key: "repairAndMaintenance", label: "Repair & maintenance" },
];

function buildingToFields(b: BuildingType): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, val] of Object.entries(b)) {
    if (SKIP_FIELDS.has(key) || val == null) continue;
    if (Array.isArray(val) || typeof val === "object") continue;
    if (typeof val === "boolean") {
      fields[key] = val ? "true" : "false";
    } else if (typeof val === "number") {
      fields[key] = String(val);
    } else if (typeof val === "string") {
      // Enum fields are stored as human-readable labels; form needs local names
      fields[key] = ENUM_FIELDS.has(key) ? (labelToLocalName[val] ?? val) : val;
    }
  }
  // Seed the investor master-data substructures as flat `_opcost_*` / `_cert_<i>_*`
  // keys (the shape updateBuilding expects), so they round-trip through the form.
  const oc = b.operatingCosts as InvestorOperatingCosts | undefined;
  if (oc) {
    for (const [k, v] of Object.entries(oc)) {
      if (v == null) continue;
      fields[`_opcost_${k}`] = typeof v === "boolean" ? (v ? "true" : "false") : String(v);
    }
  }
  const certs = b.certifications as InvestorCertification[] | undefined;
  certs?.forEach((c, i) => {
    if (c.type) fields[`_cert_${i}_type`] = c.type;
    if (c.level) fields[`_cert_${i}_level`] = c.level;
    if (c.scope) fields[`_cert_${i}_scope`] = c.scope;
  });
  return fields;
}

export default function EditBuildingDialog(
  { open, building, session, onClose, onBuildingUpdated }: EditBuildingDialogProps,
) {
  const { showNotification } = useNotification();
  const qc = useQueryClient();
  const initialFields = useMemo(() => buildingToFields(building), [building]);
  const [fields, setFields] = useState<Record<string, string>>(initialFields);
  const [saving, setSaving] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const dirty = JSON.stringify(fields) !== JSON.stringify(initialFields);

  const role = building.provenance ?? "investor";
  const fileUri = building.sourceUri ?? building.uri.split("#")[0];
  // One row per existing certification, plus a blank row to add another.
  const certCount = (building.certifications?.length ?? 0) + 1;

  const setField = (key: string, val: string) =>
    setFields((prev) => ({ ...prev, [key]: val }));

  const { tf, check, enumSelect, sectionHeader } = makeBuildingFields(
    fields,
    setField,
    "edit-building",
  );

  const handleClose = () => {
    if (saving) return;
    onClose();
  };

  const handleGeocode = async () => {
    setGeocoding(true);
    try {
      const coords = await geocodeFields(fields);
      if (!coords) {
        showNotification("Address not found", "warning");
        return;
      }
      setField("lat", coords.lat);
      setField("long", coords.long);
      setField("geocodePrecision", coords.precision);
      showNotification("Coordinates updated", "success");
    } finally {
      setGeocoding(false);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await updateBuilding(session, fileUri, building.uri as string, fields);
      // Auto-remember a WebID operator in the address book (fire-and-forget), then
      // refresh the contacts query so the new contact appears without a reload (the
      // direct rememberAgent write bypasses the addContact mutation's invalidation).
      if (fields.operatedBy) {
        // `refetchType: "all"` is load-bearing: the contacts query is INACTIVE
        // here (Connect is unmounted while this dialog is open), so a default
        // invalidate would only mark it stale — and the app's `refetchOnMount:
        // false` then suppresses the refetch when the user opens Connect, leaving
        // a stale list. Refetch the inactive query now so the new contact is
        // already present when Connect mounts.
        void rememberAgent(session, fields.operatedBy)
          .then(() =>
            qc.invalidateQueries({
              queryKey: queryKeys.contacts,
              refetchType: "all",
            })
          );
      }
      showNotification("Building updated", "success");
      onBuildingUpdated();
      onClose();
    } catch (err) {
      showNotification(formatError("update the building", err), "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dirty={dirty}
      busy={saving}
      title="Edit Building"
      actions={
        <>
          <Button onClick={handleClose} disabled={saving}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </>
      }
    >
      <Box>
        {sectionHeader("Address")}
        {tf("Street address", "streetAddress")}
        {tf("Locality (city)", "locality")}
        {tf("Postal code", "postalCode")}
        {tf("Region (state)", "region")}

        {sectionHeader("Location & Physical")}
        <Button
          variant="outlined"
          startIcon={<MyLocationIcon />}
          onClick={handleGeocode}
          disabled={geocoding}
          sx={{ mb: 1.5 }}
        >
          {geocoding ? "Looking up…" : "Update coordinates"}
        </Button>
        {tf("Latitude", "lat", { type: "number" })}
        {tf("Longitude", "long", { type: "number" })}
        {tf("Building area (m²)", "buildingArea", { type: "number" })}
        {tf("Land area (m²)", "landArea", { type: "number" })}
        {tf("Year of construction", "yearOfConstruction", { type: "number" })}
        <AgentField
          label="Operated by (WebID)"
          value={fields.operatedBy ?? ""}
          onChange={(v) => setField("operatedBy", v)}
        />
        {check("PV system installed", "hasPVSystem")}

        {role === "investor" && (
          <>
            {sectionHeader("Investor")}
            {tf("Building code", "buildingCode")}
            {tf("Label / name", "label")}
            {tf("Hall area (m²)", "hallArea", { type: "number" })}
            {tf("Office & social area (m²)", "officeSocialArea", { type: "number" })}
            {tf("Building height (m)", "buildingHeight", { type: "number" })}
            {tf("Number of loading docks", "numberOfLoadingDocks", { type: "number" })}
            {tf("Year of renovation", "yearOfRenovation", { type: "number" })}
            {tf("Lease type", "leaseType")}
            {tf("Tenant industry", "tenantIndustry")}
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

            {sectionHeader("Operating costs")}
            {OPCOST_FIELDS.map((f) =>
              f.bool
                ? <Box key={f.key}>{check(f.label, `_opcost_${f.key}`)}</Box>
                : <Box key={f.key}>{tf(f.label, `_opcost_${f.key}`)}</Box>
            )}

            {sectionHeader("Certifications")}
            {Array.from({ length: certCount }, (_, i) => (
              <Box key={i} sx={{ mb: 1.5 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  Certification {i + 1}
                </Typography>
                {tf("Type (e.g. LEED, DGNB, BREEAM)", `_cert_${i}_type`)}
                {tf("Level", `_cert_${i}_level`)}
                {tf("Scope", `_cert_${i}_scope`)}
              </Box>
            ))}
          </>
        )}

        {role === "benchmark_service_provider" && (
          <>
            {sectionHeader("Benchmark Service Provider")}
            {tf("Company name", "companyName")}
            {tf("Label / building name", "label")}
            {tf("Logistics function", "logisticsFunction")}
            {tf("Climate control type", "climateControlType")}
            {tf("Indoor temperature", "indoorTemperature")}
            {tf("Green lease share (%)", "greenLeaseShare", { type: "number" })}
            {tf("PV installation year", "pvInstallationYear", { type: "number" })}
            {tf("PV capacity (kW)", "pvCapacityKW", { type: "number" })}
            {tf("Lease type", "leaseType")}
            {tf("Tenant industry", "tenantIndustry")}
            {enumSelect("Tenancy type", "tenancyType", [
              { value: "SingleTenant", label: "Single Tenant" },
              { value: "MultiTenant", label: "Multi Tenant" },
            ])}
          </>
        )}
      </Box>
    </Modal>
  );
}

import { useMemo, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import type {
  BuildingType,
  InvestorCertification,
  InvestorOperatingCosts,
} from "../types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { investorLocalNameLabels } from "../services/rdf/building/buildingConfig.ts";
import { INVESTOR_CERT_SYSTEMS } from "../services/rdf/buildingTemplates.ts";
import { geocodeFields } from "../services/geocode.ts";
import { useSolidData } from "../hooks/queries.ts";
import { useUpdateBuilding } from "../hooks/mutations.ts";
import { makeBuildingFields } from "./buildingFields.tsx";
import Modal from "./Modal.tsx";
import { BuildingDialogTitle } from "./BuildingDialogTitle.tsx";
import {
  BuildingAddressFields,
  BuildingDetailFields,
} from "./BuildingDetailFields.tsx";
import { ADDRESS_FIELDS } from "../constants/addressFields.ts";
import { buildingFileUri } from "../services/rdf/building/buildingId.ts";

interface EditBuildingDialogProps {
  open: boolean;
  building: BuildingType;
  onClose: () => void;
}

const SKIP_FIELDS = new Set([
  "id",
  "uri",
  "sourceUri",
  "attributedTo",
  "isShared",
  "energyData",
  "certifications",
  "annualData",
  "operatingCosts",
  "customer",
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
  { open, building, onClose }: EditBuildingDialogProps,
) {
  const { showNotification } = useNotification();
  const initialFields = useMemo(() => buildingToFields(building), [building]);
  const [fields, setFields] = useState<Record<string, string>>(initialFields);
  // Busy state, error toast (central, classified) and the query invalidations
  // all come from the mutation hook; the dialog only handles success UI.
  const update = useUpdateBuilding();
  const saving = update.isPending;
  const [geocoding, setGeocoding] = useState(false);
  const dirty = JSON.stringify(fields) !== JSON.stringify(initialFields);

  const fileUri = building.sourceUri ?? buildingFileUri(building.uri);
  // One row per existing certification, plus a blank row to add another.
  const certCount = (building.certifications?.length ?? 0) + 1;

  // Mirror the Add dialog's validation (it was Add-only — an edit could blank
  // the address/coordinates, deleting those triples and unmapping the building,
  // or change the code into a collision): address + coordinates stay required,
  // and a building code, when given, must stay unique against the OTHER
  // buildings (this building's own current code is of course allowed).
  const { buildings } = useSolidData();
  const isAddressValid = ADDRESS_FIELDS.every((f) => fields[f]?.trim());
  const otherCodes = new Set(
    buildings
      .filter((b) => b.id !== building.id)
      .map((b) => b.buildingCode)
      .filter(Boolean),
  );
  const isDuplicateCode = !!fields.buildingCode?.trim() &&
    otherCodes.has(fields.buildingCode.trim());
  const isValid = isAddressValid && !isDuplicateCode;

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

  const handleSubmit = () =>
    update.mutate(
      { fileUri, subjectUri: building.uri as string, fields },
      {
        onSuccess: () => {
          showNotification("Building updated", "success");
          onClose();
        },
      },
    );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dirty={dirty}
      busy={saving}
      title={<BuildingDialogTitle building={building} action="Edit building" />}
      actions={
        <>
          <Button onClick={handleClose} disabled={saving}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={saving || !isValid}
          >
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </>
      }
    >
      <Box>
        {/* Common fields — one shared block with the Add dialog (no drift). */}
        <BuildingAddressFields
          f={{ tf, check, enumSelect, sectionHeader }}
          fields={fields}
          setField={setField}
          isRequired={(f) => ADDRESS_FIELDS.includes(f)}
          geocode={{
            onClick: handleGeocode,
            busy: geocoding,
            label: "Update coordinates",
          }}
        />

        <BuildingDetailFields
          f={{ tf, check, enumSelect, sectionHeader }}
          buildingCode={{
            error: isDuplicateCode,
            helperText: isDuplicateCode
              ? "Building code already exists"
              : undefined,
          }}
        />

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
            {/* The type mints an IRI local name (`bldg:<type>Certification`),
                so it's a select over the known systems, not free text — an
                arbitrary string would make the building file unparseable. */}
            {enumSelect(
              "Type",
              `_cert_${i}_type`,
              INVESTOR_CERT_SYSTEMS.map((s) => ({ value: s, label: s })),
            )}
            {tf("Level", `_cert_${i}_level`)}
            {tf("Scope", `_cert_${i}_scope`)}
          </Box>
        ))}
      </Box>
    </Modal>
  );
}

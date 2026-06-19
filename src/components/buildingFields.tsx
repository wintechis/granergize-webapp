import type { ReactElement } from "react";
import {
  Box,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import type {
  BuildingType,
  InvestorCertification,
  InvestorOperatingCosts,
} from "../types.ts";
import { investorLocalNameLabels } from "../services/rdf/building/buildingConfig.ts";
import type { MessageId } from "../lib/messages.ts";

export interface BuildingFieldHelpers {
  /** A labelled text field bound to `fields[field]`. */
  tf: (
    label: string,
    field: string,
    opts?: { type?: string; required?: boolean; error?: boolean; helperText?: string },
  ) => ReactElement;
  /** A checkbox bound to `fields[field]` ("true"/"false"). */
  check: (label: string, field: string) => ReactElement;
  /** A select of `options` (value→label) bound to `fields[field]`, with an
   * accessible `labelId` so the control has a name. */
  enumSelect: (
    label: string,
    field: string,
    options: { value: string; label: string }[],
  ) => ReactElement;
  /** A section heading with a divider. */
  sectionHeader: (title: string) => ReactElement;
}

/**
 * Shared field-render helpers for the building Add/Edit dialogs, so both render
 * text fields, checkboxes, enum selects and section headers identically (one
 * widget vocabulary, per the UI conventions). Closes over the dialog's `fields`
 * map + `setField`; call once in the component body. `idPrefix` namespaces the
 * select `labelId`s so the two dialogs don't collide if both ever mount.
 */
export function makeBuildingFields(
  fields: Record<string, string>,
  setField: (key: string, val: string) => void,
  idPrefix = "building-field",
): BuildingFieldHelpers {
  const tf: BuildingFieldHelpers["tf"] = (label, field, opts) => (
    <TextField
      label={label}
      size="small"
      fullWidth
      required={opts?.required}
      type={opts?.type ?? "text"}
      error={opts?.error}
      helperText={opts?.helperText}
      value={fields[field] ?? ""}
      onChange={(e) => setField(field, e.target.value)}
      sx={{ mb: 1.5 }}
    />
  );

  const check: BuildingFieldHelpers["check"] = (label, field) => (
    <FormControlLabel
      control={
        <Checkbox
          checked={fields[field] === "true"}
          onChange={(e) => setField(field, e.target.checked ? "true" : "false")}
          size="small"
        />
      }
      label={label}
      sx={{ mb: 0.5 }}
    />
  );

  const enumSelect: BuildingFieldHelpers["enumSelect"] = (label, field, options) => (
    <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
      <InputLabel id={`${idPrefix}-${field}-label`}>{label}</InputLabel>
      <Select
        labelId={`${idPrefix}-${field}-label`}
        label={label}
        value={fields[field] ?? ""}
        onChange={(e) => setField(field, e.target.value)}
      >
        <MenuItem value=""><em>—</em></MenuItem>
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  const sectionHeader: BuildingFieldHelpers["sectionHeader"] = (title) => (
    <Box sx={{ mt: 2, mb: 1 }}>
      <Typography variant="h6" color="text.secondary">{title}</Typography>
      <Divider />
    </Box>
  );

  return { tf, check, enumSelect, sectionHeader };
}

/** Investor operating-cost categories rendered as `_opcost_<key>` form rows (mirrors
 * OPCOST_FIELDS in buildingSerializer). One boolean; the rest free-text currency
 * values. Shared by the EditBuildingDialog AND the building page's inline editor. */
export const OPCOST_FIELDS: { key: string; labelId: MessageId; bool?: boolean }[] = [
  { key: "wasteDisposal", labelId: "lblOpcostWasteDisposal" },
  { key: "insurance", labelId: "lblOpcostInsurance" },
  {
    key: "operationInspectionAndMaintenance",
    labelId: "lblOpcostOperationInspectionAndMaintenance",
    bool: true,
  },
  { key: "routineCleaningOffice", labelId: "lblOpcostRoutineCleaningOffice" },
  { key: "routineCleaningWarehouse", labelId: "lblOpcostRoutineCleaningWarehouse" },
  { key: "glassCleaning", labelId: "lblOpcostGlassCleaning" },
  { key: "exteriorMaintenance", labelId: "lblOpcostExteriorMaintenance" },
  { key: "security", labelId: "lblOpcostSecurity" },
  { key: "propertyManagement", labelId: "lblOpcostPropertyManagement" },
  { key: "caretaker", labelId: "lblOpcostCaretaker" },
  { key: "repairAndMaintenance", labelId: "lblOpcostRepairAndMaintenance" },
];

/** Scalar building keys that never become editable form fields (identity, derived
 * collections, or the nested sub-structures seeded explicitly below). */
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

/** Fields stored as human-readable labels in the object model; the form edits the
 * controlled-vocab local name, so they're reversed on seed. */
const ENUM_FIELDS = new Set([
  "shiftRegime",
  "tenancyType",
  "indoorTemperatureClass",
]);

/** Reverse of `investorLocalNameLabels`: human label → local name. */
const labelToLocalName: Record<string, string> = Object.fromEntries(
  Object.entries(investorLocalNameLabels).map(([ln, label]) => [label, ln]),
);

/**
 * Seed the Add/Edit dialogs' flat `fields` map from a building — the inverse of the
 * serializer's field convention, so the form round-trips through `updateBuilding`.
 * Scalars go in by key; the nested investor operating-costs / certifications and the
 * PV-system node are flattened to the `_opcost_*` / `_cert_<i>_*` / `_pv_*` keys those
 * write/replace helpers expect. Shared by the EditBuildingDialog AND the building
 * page's inline editor (the single source — was duplicated in both).
 */
export function buildingToFields(b: BuildingType): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, val] of Object.entries(b)) {
    if (SKIP_FIELDS.has(key) || val == null) continue;
    if (Array.isArray(val) || typeof val === "object") continue;
    if (typeof val === "boolean") {
      fields[key] = val ? "true" : "false";
    } else if (typeof val === "number") {
      fields[key] = String(val);
    } else if (typeof val === "string") {
      // Enum fields are stored as human-readable labels; the form needs local names.
      fields[key] = ENUM_FIELDS.has(key) ? (labelToLocalName[val] ?? val) : val;
    }
  }
  const oc = b.operatingCosts as InvestorOperatingCosts | undefined;
  if (oc) {
    for (const [k, v] of Object.entries(oc)) {
      if (v == null) continue;
      fields[`_opcost_${k}`] = typeof v === "boolean"
        ? (v ? "true" : "false")
        : String(v);
    }
  }
  const certs = b.certifications as InvestorCertification[] | undefined;
  certs?.forEach((c, i) => {
    if (c.type) fields[`_cert_${i}_type`] = c.type;
    if (c.level) fields[`_cert_${i}_level`] = c.level;
    if (c.scope) fields[`_cert_${i}_scope`] = c.scope;
  });
  // Energy units (PV/battery/CHP) are NOT flat fields anymore — they're edited as a
  // TechnicalSystem[] in the per-unit editor and written via updateBuilding's `systems`
  // param, so buildingToFields no longer round-trips them (a plain building edit leaves
  // the units untouched).
  return fields;
}

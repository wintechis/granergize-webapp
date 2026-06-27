/**
 * Seed the building Add/Edit dialogs' flat `fields` map from a {@link Building}
 * — the inverse of the serializer's field convention, so the form round-trips
 * through `updateBuilding`. A pure module (no React/MUI), split out from the
 * MUI-bound field helpers in `buildingFields.tsx` so the seed is unit-testable under
 * Deno (the MUI barrel can't be imported there).
 */
import type {
  Building,
  InvestorCertification,
  InvestorOperatingCosts,
} from "../types.ts";

/** Scalar building keys that never become editable form fields (identity, derived
 * collections, or the nested sub-structures seeded explicitly below). `type` is the
 * building's `rdf:type` (always `rec:Building`) — structural, not master data, so it
 * stays un-editable; `customer`/`naceCode` ARE editable master data (seeded below). */
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
  "type",
  "energyCertificate",
]);

/**
 * Seed the Add/Edit dialogs' flat `fields` map from a building. Scalars go in by key;
 * the nested investor operating-costs / certifications and the PV-system node are
 * flattened to the `_opcost_*` / `_cert_<i>_*` / `_pv_*` keys those write/replace
 * helpers expect. Shared by the EditBuildingDialog AND the building page's inline
 * editor (the single source).
 */
export function buildingToFields(b: Building): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, val] of Object.entries(b)) {
    if (SKIP_FIELDS.has(key) || val == null) continue;
    if (Array.isArray(val) || typeof val === "object") continue;
    if (typeof val === "boolean") {
      fields[key] = val ? "true" : "false";
    } else if (typeof val === "number") {
      fields[key] = String(val);
    } else if (typeof val === "string") {
      fields[key] = val;
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
    if (c.certificationLevel) fields[`_cert_${i}_level`] = c.certificationLevel;
    if (c.certificationScope) fields[`_cert_${i}_scope`] = c.certificationScope;
  });
  // Energy units (PV/battery/CHP) are NOT flat fields — they're edited as a
  // TechnicalSystem[] in the per-unit editor and written via updateBuilding's
  // `systems` param, so buildingToFields no longer round-trips them (a plain
  // building edit leaves the units untouched).
  return fields;
}

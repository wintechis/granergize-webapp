import { msg } from "../../lib/messages.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import {
  Check as CheckIcon,
  Clear as ClearIcon,
} from "@mui/icons-material";
import type {
  Building,
  InvestorOperatingCosts,
} from "../../types.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { useSolidData } from "../../hooks/queries.ts";
import { useUpdateBuilding } from "../../hooks/mutations.ts";
import { useGeocodeFields } from "../../hooks/useGeocodeFields.ts";
import { makeBuildingFields, OPCOST_FIELDS } from "../buildingFields.tsx";
import { buildingToFields } from "../buildingFormSeed.ts";
import {
  BuildingAddressFields,
  BuildingDetailFields,
} from "../BuildingDetailFields.tsx";
import { ADDRESS_FIELDS } from "../../constants/addressFields.ts";
import { buildingFileUri } from "../../services/rdf/building/buildingId.ts";
import { fieldLabel, optionLabel } from "../../services/rdf/vocabLabels.ts";
import { BUILDING_NS } from "../../services/rdf/vocabularies.ts";
import { INVESTOR_CERT_SYSTEMS } from "../../services/xlsx/buildingTemplates.ts";
import { AgentLabel } from "../AgentLabel.tsx";
import { DetailRow, SectionTitle } from "../detail/DetailView.tsx";

/** Display label for a controlled-vocab TOKEN stored on the building (e.g. "OneShift"
 *  → "1-Shift"), resolved through the vocab catalog. */
const enumLabel = (token?: string): string =>
  token ? optionLabel(`${BUILDING_NS}${token}`) : "";

const hasValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return !Number.isNaN(value);
  return true;
};

const boolIcon = (v: boolean) =>
  v ? <CheckIcon fontSize="small" /> : <ClearIcon fontSize="small" />;


/** The read-first master-data view: every populated master-data field as a row. */
function ReadView({ building }: { building: Building }) {
  const operatingCostEntries = Object.entries(
    (building.operatingCosts ?? {}) as InvestorOperatingCosts,
  ).filter(([, value]) => hasValue(value));

  return (
    <>
      {hasValue(building.operatedBy) && (
        <DetailRow
          label={fieldLabel("operatedBy")}
          value={<AgentLabel value={building.operatedBy as string} />}
        />
      )}
      {hasValue(building.ownedBy) && (
        <DetailRow
          label={fieldLabel("ownedBy")}
          value={<AgentLabel value={building.ownedBy as string} />}
        />
      )}
      {hasValue(building.investor) && (
        <DetailRow
          label={fieldLabel("investor")}
          value={<AgentLabel value={building.investor as string} />}
        />
      )}
      {hasValue(building.facilityManagedBy) && (
        <DetailRow
          label={fieldLabel("facilityManagedBy")}
          value={<AgentLabel value={building.facilityManagedBy as string} />}
        />
      )}
      {hasValue(building.developedBy) && (
        <DetailRow
          label={fieldLabel("developedBy")}
          value={<AgentLabel value={building.developedBy as string} />}
        />
      )}
      {hasValue(building.consultedBy) && (
        <DetailRow
          label={fieldLabel("consultedBy")}
          value={<AgentLabel value={building.consultedBy as string} />}
        />
      )}
      {building.buildingArea != null && (
        <DetailRow label={fieldLabel("buildingArea")} value={building.buildingArea} />
      )}
      {building.landArea != null && (
        <DetailRow label={fieldLabel("landArea")} value={building.landArea} />
      )}
      {building.hallArea != null && (
        <DetailRow label={fieldLabel("hallArea")} value={building.hallArea} />
      )}
      {building.officeSocialArea != null && (
        <DetailRow
          label={fieldLabel("officeSocialArea")}
          value={building.officeSocialArea}
        />
      )}
      {building.buildingHeight != null && (
        <DetailRow label={fieldLabel("buildingHeight")} value={building.buildingHeight} />
      )}
      {building.numberOfLoadingDocks != null && (
        <DetailRow label={fieldLabel("numberOfLoadingDocks")} value={building.numberOfLoadingDocks} />
      )}
      {building.yearOfConstruction != null && (
        <DetailRow
          label={fieldLabel("yearOfConstruction")}
          value={building.yearOfConstruction}
        />
      )}
      {building.yearOfRenovation != null && (
        <DetailRow label={fieldLabel("yearOfRenovation")} value={building.yearOfRenovation} />
      )}
      {hasValue(building.shiftRegime) && (
        <DetailRow label={fieldLabel("shiftRegime")} value={enumLabel(building.shiftRegime)} />
      )}
      {hasValue(building.tenancyType) && (
        <DetailRow label={fieldLabel("tenancyType")} value={enumLabel(building.tenancyType)} />
      )}
      {hasValue(building.leaseType) && (
        <DetailRow label={fieldLabel("leaseType")} value={building.leaseType} />
      )}
      {hasValue(building.tenantIndustry) && (
        <DetailRow label={fieldLabel("tenantIndustry")} value={building.tenantIndustry} />
      )}
      {hasValue(building.customer) && (
        <DetailRow label={fieldLabel("customer")} value={building.customer} />
      )}
      {hasValue(building.naceCode) && (
        <DetailRow label={fieldLabel("naceCode")} value={building.naceCode} />
      )}
      {hasValue(building.indoorTemperatureClass) && (
        <DetailRow
          label={fieldLabel("indoorTemperatureClass")}
          value={enumLabel(building.indoorTemperatureClass)}
        />
      )}
      {/* Heat generators moved out of master data — they're :TechnicalSystem nodes shown +
          edited in the "Heat generation" section (like PV/battery/CHP in Energy systems). */}

      {/* Baked LoD2-BY (LDBV) authoritative metadata — read-only, shown beside the app's
          own master data. Each row renders only when the imported record carried it. */}
      {hasValue(building.lod2AlkisId) && (
        <DetailRow label={msg("lod2AlkisIdLabel")} value={building.lod2AlkisId} />
      )}
      {hasValue(building.lod2RoofType) && (
        <DetailRow label={msg("lod2RoofTypeLabel")} value={building.lod2RoofType} />
      )}
      {building.lod2Storeys != null && (
        <DetailRow label={msg("lod2StoreysLabel")} value={building.lod2Storeys} />
      )}
      {hasValue(building.lod2CreationDate) && (
        <DetailRow label={msg("lod2CreationDateLabel")} value={building.lod2CreationDate} />
      )}

      {Array.isArray(building.certifications) &&
        building.certifications.length > 0 && (
        <>
          <SectionTitle divider>{msg("secCertifications")}</SectionTitle>
          {building.certifications.map((cert, i) => (
            <DetailRow
              key={i}
              label={cert.type}
              value={`${cert.certificationLevel}${
                cert.certificationScope ? ` (${cert.certificationScope})` : ""
              }`}
            />
          ))}
        </>
      )}

      {operatingCostEntries.length > 0 && (
        <>
          <SectionTitle divider>{msg("secOperatingCosts")}</SectionTitle>
          {operatingCostEntries.map(([k, v]) => (
            <DetailRow
              key={k}
              dense
              label={
                <span style={{ textTransform: "capitalize" }}>
                  {k.replace(/([A-Z])/g, " $1").trim()}
                </span>
              }
              value={typeof v === "boolean" ? boolIcon(v) : enumLabel(String(v))}
            />
          ))}
        </>
      )}
    </>
  );
}

/** The inline editor — the same fields the Edit dialog offers, but on the page. */
function EditView(
  { building, onDone }: { building: Building; onDone: () => void },
) {
  const { showNotification } = useNotification();
  const initialFields = useMemo(() => buildingToFields(building), [building]);
  const [fields, setFields] = useState<Record<string, string>>(initialFields);
  // Re-seed when the building changes while the form is still pristine — a
  // successful save closes the editor and triggers a refetch, so reopening the
  // editor before that refetch lands would otherwise show the stale (pre-save)
  // values forever (the `key` is the URI, which doesn't change across a refetch,
  // so the mount-time `useState` seed never re-runs). We re-seed only when the
  // form still matches the last seed (pristine), so a refetch landing mid-edit
  // never clobbers in-progress edits.
  const lastSeedRef = useRef(initialFields);
  useEffect(() => {
    const prevSeed = lastSeedRef.current;
    if (initialFields === prevSeed) return; // same building object
    lastSeedRef.current = initialFields;
    setFields((cur) => (cur === prevSeed ? initialFields : cur));
  }, [initialFields]);
  const update = useUpdateBuilding();
  const saving = update.isPending;

  const fileUri = building.sourceUri ?? buildingFileUri(building.uri);
  const certCount = (building.certifications?.length ?? 0) + 1;

  // Same validation as the Edit dialog: address + coordinates stay required, and
  // a building code, when given, stays unique against the OTHER buildings.
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

  const { onGeocode, busy: geocoding } = useGeocodeFields(
    fields,
    setField,
    msg("coordinatesUpdated"),
  );

  const handleSave = () =>
    update.mutate(
      { fileUri, subjectUri: building.uri as string, fields },
      {
        onSuccess: () => {
          showNotification(msg("buildingUpdated"), "success");
          onDone();
        },
      },
    );

  return (
    <Box>
      <BuildingAddressFields
        f={{ tf, check, enumSelect, sectionHeader }}
        fields={fields}
        setField={setField}
        isRequired={(f) => ADDRESS_FIELDS.includes(f)}
        geocode={{ onClick: onGeocode, busy: geocoding, label: "Update coordinates" }}
      />

      <BuildingDetailFields
        f={{ tf, check, enumSelect, sectionHeader }}
        buildingCode={{
          error: isDuplicateCode,
          helperText: isDuplicateCode ? msg("buildingCodeExists") : undefined,
        }}
      />

      {sectionHeader(msg("secOperatingCosts"))}
      {OPCOST_FIELDS.map((f) => (
        <Box key={f.key}>{tf(msg(f.labelId), `_opcost_${f.key}`)}</Box>
      ))}

      {sectionHeader(msg("secCertifications"))}
      {Array.from({ length: certCount }, (_, i) => (
        <Box key={i} sx={{ mb: 1.5 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
            {msg("lblCertificationN", { n: i + 1 })}
          </Typography>
          {enumSelect(
            msg("lblCertType"),
            `_cert_${i}_type`,
            INVESTOR_CERT_SYSTEMS.map((s) => ({ value: s, label: s })),
          )}
          {tf(msg("lblCertLevel"), `_cert_${i}_level`)}
          {tf(msg("lblCertScope"), `_cert_${i}_scope`)}
        </Box>
      ))}

      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button onClick={onDone} disabled={saving}>{msg("btnCancel")}</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !isValid}
        >
          {saving ? msg("btnSaving") : msg("btnSave")}
        </Button>
      </Stack>
    </Box>
  );
}

/**
 * The building page's Master data section. Read-first: shows the building's master-data
 * fields as rows; an [Edit] button flips the same fields to an INLINE editor on
 * the page (no modal), saving through {@link useUpdateBuilding}. A shared
 * building is read-only (no Edit) — the recipient doesn't own the file.
 */
export default function MasterDataSection(
  { building, autoOpenEdit }: {
    building: Building;
    /** Open the inline editor on mount (the palette routed here `?action=edit`). */
    autoOpenEdit?: boolean;
  },
) {
  const canEdit = !building.isShared;
  // Honour a palette-routed `?action=edit` by SEEDING the edit state from the
  // prop (no setState-in-effect): flip to the inline editor on arrival, only
  // when editing is allowed (a shared building is read-only).
  const [editing, setEditing] = useState(() => autoOpenEdit === true && canEdit);

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
      >
        <Typography variant="h6">{msg("secMasterData")}</Typography>
        {canEdit && !editing && (
          <Button
            size="small"
            startIcon={<EditIcon fontSize="small" />}
            onClick={() => setEditing(true)}
          >
            {msg("btnEdit")}
          </Button>
        )}
      </Stack>
      {editing
        // key on the building uri so switching to a different building remounts
        // the editor; re-seeding after a same-building refetch is handled by the
        // pristine-guarded effect in EditView (the uri is stable across refetch).
        ? (
          <EditView
            key={building.uri as string}
            building={building}
            onDone={() => setEditing(false)}
          />
        )
        : <Stack spacing={1}><ReadView building={building} /></Stack>}
    </Box>
  );
}

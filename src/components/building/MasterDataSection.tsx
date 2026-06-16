import { msg } from "../../lib/messages.ts";
import { useMemo, useState } from "react";
import { Box, Button, Stack, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import {
  Check as CheckIcon,
  Clear as ClearIcon,
} from "@mui/icons-material";
import type {
  BuildingType,
  InvestorOperatingCosts,
  PvSystem,
} from "../../types.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { useSolidData } from "../../hooks/queries.ts";
import { useUpdateBuilding } from "../../hooks/mutations.ts";
import { useGeocodeFields } from "../../hooks/useGeocodeFields.ts";
import {
  buildingToFields,
  makeBuildingFields,
  OPCOST_FIELDS,
} from "../buildingFields.tsx";
import {
  BuildingAddressFields,
  BuildingDetailFields,
} from "../BuildingDetailFields.tsx";
import { ADDRESS_FIELDS } from "../../constants/addressFields.ts";
import { buildingFileUri } from "../../services/rdf/building/buildingId.ts";
import { INVESTOR_CERT_SYSTEMS } from "../../services/rdf/buildingTemplates.ts";
import { AgentLabel } from "../AgentLabel.tsx";
import { DetailRow, SectionTitle } from "../detail/DetailView.tsx";

const hasValue = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return !Number.isNaN(value);
  return true;
};

const boolIcon = (v: boolean) =>
  v ? <CheckIcon fontSize="small" /> : <ClearIcon fontSize="small" />;

/** One-line summary of the PV plant ("750 kW, since 2018"), or "Yes" when present
 * but undetailed. The operator is shown as its own resolved-agent row. */
const pvSystemSummary = (pv: PvSystem): string => {
  const parts: string[] = [];
  if (pv.capacityKW != null) parts.push(`${pv.capacityKW} kW`);
  if (pv.commissioningYear != null) parts.push(`since ${pv.commissioningYear}`);
  return parts.length ? parts.join(", ") : "Yes";
};

/** The read-first master-data view: every populated master-data field as a row. */
function ReadView({ building }: { building: BuildingType }) {
  const operatingCostEntries = Object.entries(
    (building.operatingCosts ?? {}) as InvestorOperatingCosts,
  ).filter(([, value]) => hasValue(value));

  return (
    <>
      {hasValue(building.operatedBy) && (
        <DetailRow
          label="Operated by"
          value={<AgentLabel value={building.operatedBy as string} />}
        />
      )}
      {hasValue(building.ownedBy) && (
        <DetailRow
          label="Owned by"
          value={<AgentLabel value={building.ownedBy as string} />}
        />
      )}
      {hasValue(building.investor) && (
        <DetailRow
          label="Investor"
          value={<AgentLabel value={building.investor as string} />}
        />
      )}
      {hasValue(building.facilityManagedBy) && (
        <DetailRow
          label="Facility manager"
          value={<AgentLabel value={building.facilityManagedBy as string} />}
        />
      )}
      {hasValue(building.developedBy) && (
        <DetailRow
          label="Developed by"
          value={<AgentLabel value={building.developedBy as string} />}
        />
      )}
      {hasValue(building.consultedBy) && (
        <DetailRow
          label="Consultant / broker"
          value={<AgentLabel value={building.consultedBy as string} />}
        />
      )}
      {building.buildingArea != null && (
        <DetailRow label="Building area" value={`${building.buildingArea} m²`} />
      )}
      {building.landArea != null && (
        <DetailRow label="Land area" value={`${building.landArea} m²`} />
      )}
      {building.hallArea != null && (
        <DetailRow label="Hall area" value={`${building.hallArea} m²`} />
      )}
      {building.officeSocialArea != null && (
        <DetailRow
          label="Office and social area"
          value={`${building.officeSocialArea} m²`}
        />
      )}
      {building.buildingHeight != null && (
        <DetailRow label="Building height" value={`${building.buildingHeight} m`} />
      )}
      {building.numberOfLoadingDocks != null && (
        <DetailRow label="Loading docks" value={building.numberOfLoadingDocks} />
      )}
      {building.yearOfConstruction != null && (
        <DetailRow
          label="Year of construction"
          value={building.yearOfConstruction}
        />
      )}
      {building.yearOfRenovation != null && (
        <DetailRow label="Year of renovation" value={building.yearOfRenovation} />
      )}
      {hasValue(building.shiftRegime) && (
        <DetailRow label="Shift regime" value={building.shiftRegime} />
      )}
      {hasValue(building.tenancyType) && (
        <DetailRow label="Tenancy type" value={building.tenancyType} />
      )}
      {hasValue(building.leaseType) && (
        <DetailRow label="Lease type" value={building.leaseType} />
      )}
      {hasValue(building.tenantIndustry) && (
        <DetailRow label="Tenant industry" value={building.tenantIndustry} />
      )}
      {hasValue(building.indoorTemperatureClass) && (
        <DetailRow
          label="Indoor temperature"
          value={building.indoorTemperatureClass}
        />
      )}
      {building.pvSystem && (
        <DetailRow label="PV system" value={pvSystemSummary(building.pvSystem)} />
      )}
      {building.pvSystem?.operatedBy && (
        <DetailRow
          label="PV operator"
          value={<AgentLabel value={building.pvSystem.operatedBy} />}
        />
      )}

      {(building.hasOilBoiler != null ||
        building.hasGasBoiler != null ||
        building.hasElectricBoiler != null ||
        building.hasHeatPump != null ||
        building.hasDistrictHeating != null) && (
        <>
          <SectionTitle divider>Heat generation</SectionTitle>
          {building.hasDistrictHeating != null && (
            <DetailRow
              label="District heating"
              value={boolIcon(building.hasDistrictHeating)}
            />
          )}
          {building.hasHeatPump != null && (
            <DetailRow label="Heat pump" value={boolIcon(building.hasHeatPump)} />
          )}
          {building.hasGasBoiler != null && (
            <DetailRow label="Gas boiler" value={boolIcon(building.hasGasBoiler)} />
          )}
          {building.hasOilBoiler != null && (
            <DetailRow label="Oil boiler" value={boolIcon(building.hasOilBoiler)} />
          )}
          {building.hasElectricBoiler != null && (
            <DetailRow
              label="Electric boiler"
              value={boolIcon(building.hasElectricBoiler)}
            />
          )}
        </>
      )}

      {Array.isArray(building.certifications) &&
        building.certifications.length > 0 && (
        <>
          <SectionTitle divider>Certifications</SectionTitle>
          {building.certifications.map((cert, i) => (
            <DetailRow
              key={i}
              label={cert.type}
              value={`${cert.level}${cert.scope ? ` (${cert.scope})` : ""}`}
            />
          ))}
        </>
      )}

      {operatingCostEntries.length > 0 && (
        <>
          <SectionTitle divider>Operating costs</SectionTitle>
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
  );
}

/** The inline editor — the same fields the Edit dialog offers, but on the page. */
function EditView(
  { building, onDone }: { building: BuildingType; onDone: () => void },
) {
  const { showNotification } = useNotification();
  const initialFields = useMemo(() => buildingToFields(building), [building]);
  const [fields, setFields] = useState<Record<string, string>>(initialFields);
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
          helperText: isDuplicateCode ? "Building code already exists" : undefined,
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
          {enumSelect(
            "Type",
            `_cert_${i}_type`,
            INVESTOR_CERT_SYSTEMS.map((s) => ({ value: s, label: s })),
          )}
          {tf("Level", `_cert_${i}_level`)}
          {tf("Scope", `_cert_${i}_scope`)}
        </Box>
      ))}

      <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
        <Button onClick={onDone} disabled={saving}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !isValid}
        >
          {saving ? "Saving…" : "Save"}
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
export default function MasterDataSection({ building }: { building: BuildingType }) {
  const [editing, setEditing] = useState(false);
  const canEdit = !building.isShared;

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
      >
        <Typography variant="h6">Master data</Typography>
        {canEdit && !editing && (
          <Button
            size="small"
            startIcon={<EditIcon fontSize="small" />}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        )}
      </Stack>
      {editing
        // key on the building uri so a refetched building re-seeds the form.
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

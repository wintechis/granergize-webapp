import { msg } from "../lib/messages.ts";
import { useMemo, useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import type { BuildingType } from "../types.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { INVESTOR_CERT_SYSTEMS } from "../services/rdf/buildingTemplates.ts";
import { useGeocodeFields } from "../hooks/useGeocodeFields.ts";
import { useSolidData } from "../hooks/queries.ts";
import { useUpdateBuilding } from "../hooks/mutations.ts";
import {
  buildingToFields,
  makeBuildingFields,
  OPCOST_FIELDS,
} from "./buildingFields.tsx";
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

  const { onGeocode, busy: geocoding } = useGeocodeFields(
    fields,
    setField,
    msg("coordinatesUpdated"),
  );

  const handleSubmit = () =>
    update.mutate(
      { fileUri, subjectUri: building.uri as string, fields },
      {
        onSuccess: () => {
          showNotification(msg("buildingUpdated"), "success");
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
            onClick: onGeocode,
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

        {sectionHeader(msg("secOperatingCosts"))}
        {OPCOST_FIELDS.map((f) =>
          f.bool
            ? <Box key={f.key}>{check(f.label, `_opcost_${f.key}`)}</Box>
            : <Box key={f.key}>{tf(f.label, `_opcost_${f.key}`)}</Box>
        )}

        {sectionHeader(msg("secCertifications"))}
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

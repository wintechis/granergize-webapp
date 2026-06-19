import { msg } from "../../lib/messages.ts";
import { useMemo, useState } from "react";
import { Box, Button } from "@mui/material";
import type { BuildingType } from "../../types.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { useUpdateBuilding } from "../../hooks/mutations.ts";
import { buildingToFields, makeBuildingFields } from "../buildingFields.tsx";
import Modal from "../Modal.tsx";
import { buildingFileUri } from "../../services/rdf/building/buildingId.ts";

/**
 * Add / edit a building's energy systems — the `<#pv>` / `<#battery>` / `<#chp>`
 * technical-system nodes (`bldg:hasSystem`). Split out of the create/edit building
 * form so units are managed on the building's own page, not while creating it.
 *
 * Reuses the building field machinery: it seeds the FULL field record
 * (`buildingToFields`) so the whole-file update preserves every non-system field,
 * and only the `_pv_*`/`_battery_*`/`_chp_*` keys are editable here. Saving routes
 * through {@link useUpdateBuilding} → `replaceSystems` (drops + rebuilds the system
 * nodes from these fields), so clearing a field removes that part of the unit.
 */
export default function EnergySystemsDialog(
  { open, building, onClose }: {
    open: boolean;
    building: BuildingType;
    onClose: () => void;
  },
) {
  const { showNotification } = useNotification();
  const initialFields = useMemo(() => buildingToFields(building), [building]);
  const [fields, setFields] = useState<Record<string, string>>(initialFields);
  const update = useUpdateBuilding();
  const saving = update.isPending;
  const dirty = JSON.stringify(fields) !== JSON.stringify(initialFields);
  const fileUri = building.sourceUri ?? buildingFileUri(building.uri);

  const setField = (key: string, val: string) =>
    setFields((prev) => ({ ...prev, [key]: val }));
  const { tf, sectionHeader } = makeBuildingFields(fields, setField, "energy-systems");

  const handleClose = () => {
    if (!saving) onClose();
  };
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
      title={msg("secEnergySystems")}
      actions={
        <>
          <Button onClick={handleClose} disabled={saving}>{msg("btnCancel")}</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={saving}>
            {saving ? msg("btnSaving") : msg("saveChanges")}
          </Button>
        </>
      }
    >
      <Box>
        {sectionHeader(msg("mdPvSystem"))}
        {tf(msg("lblPvCapacity"), "_pv_capacityKW", { type: "number" })}
        {tf(msg("lblPvCommissioning"), "_pv_commissioningYear", { type: "number" })}
        {tf(msg("lblPvOperator"), "_pv_operatedBy")}

        {sectionHeader(msg("mdBatteryStorage"))}
        {tf(msg("lblBatteryCapacity"), "_battery_capacityKWh", { type: "number" })}
        {tf(msg("lblBatteryCommissioning"), "_battery_commissioningYear", { type: "number" })}
        {tf(msg("lblBatteryOperator"), "_battery_operatedBy")}

        {sectionHeader(msg("mdChpSystem"))}
        {tf(msg("lblChpCapacity"), "_chp_capacityKW", { type: "number" })}
        {tf(msg("lblChpThermal"), "_chp_thermalCapacityKW", { type: "number" })}
        {tf(msg("lblChpCommissioning"), "_chp_commissioningYear", { type: "number" })}
        {tf(msg("lblChpOperator"), "_chp_operatedBy")}
      </Box>
    </Modal>
  );
}

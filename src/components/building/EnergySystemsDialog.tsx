import { msg } from "../../lib/messages.ts";
import { useMemo, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import type { BuildingType, SystemKind, TechnicalSystem } from "../../types.ts";
import { useNotification } from "../../context/NotificationContext.tsx";
import { useUpdateBuilding } from "../../hooks/mutations.ts";
import Modal from "../Modal.tsx";
import { buildingFileUri } from "../../services/rdf/building/buildingId.ts";

/**
 * Add / edit / remove a building's energy units — the `bldg:hasSystem` nodes. A
 * building may carry SEVERAL of a kind (two PV plants, a battery, a CHP), so this is a
 * list editor: each unit is its own card with a stable `id` (kept across edits so a
 * per-unit observation's feature-of-interest stays valid). The whole list is submitted
 * via {@link useUpdateBuilding}'s `systems` param → `replaceSystems`, so a removed unit's
 * node disappears and an added one's (minted id) lands. Master-data fields are untouched
 * (an empty `fields` map).
 */
export default function EnergySystemsDialog(
  { open, building, onClose }: {
    open: boolean;
    building: BuildingType;
    onClose: () => void;
  },
) {
  const { showNotification } = useNotification();
  const initial = useMemo(
    () => ((building.systems ?? []) as TechnicalSystem[]).map((s) => ({ ...s })),
    [building],
  );
  const [systems, setSystems] = useState<TechnicalSystem[]>(initial);
  const update = useUpdateBuilding();
  const saving = update.isPending;
  const dirty = JSON.stringify(systems) !== JSON.stringify(initial);
  const fileUri = building.sourceUri ?? buildingFileUri(building.uri as string);

  const kindLabel = (kind: SystemKind) =>
    kind === "battery"
      ? msg("mdBatteryStorage")
      : kind === "chp"
      ? msg("mdChpSystem")
      : msg("mdPvSystem");

  const addUnit = (kind: SystemKind) =>
    setSystems((prev) => [...prev, { id: `sys-${crypto.randomUUID().slice(0, 8)}`, kind }]);
  const removeUnit = (id: string) =>
    setSystems((prev) => prev.filter((s) => s.id !== id));
  const setNum = (id: string, key: keyof TechnicalSystem, raw: string) =>
    setSystems((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, [key]: raw.trim() === "" ? undefined : Number(raw) } : s
      )
    );
  const setText = (id: string, key: keyof TechnicalSystem, raw: string) =>
    setSystems((prev) =>
      prev.map((s) => s.id === id ? { ...s, [key]: raw.trim() || undefined } : s)
    );

  const handleClose = () => {
    if (!saving) onClose();
  };
  const handleSubmit = () =>
    update.mutate(
      { fileUri, subjectUri: building.uri as string, fields: {}, systems },
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
      <Stack spacing={3}>
        {systems.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {msg("energySystemsEmpty")}
          </Typography>
        )}
        {systems.map((s) => (
          <Box
            key={s.id}
            sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
          >
            <Stack
              direction="row"
              sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
            >
              <Typography variant="subtitle2">{kindLabel(s.kind)}</Typography>
              <Tooltip title={msg("btnDelete")}>
                <IconButton
                  size="small"
                  aria-label={msg("btnDelete")}
                  onClick={() => removeUnit(s.id)}
                  disabled={saving}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
            <Stack spacing={2}>
              {s.kind === "battery"
                ? (
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label={msg("lblSystemCapacityKWh")}
                    value={s.storageCapacityKWh ?? ""}
                    onChange={(e) => setNum(s.id, "storageCapacityKWh", e.target.value)}
                  />
                )
                : (
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label={msg("lblSystemCapacityKW")}
                    value={s.capacityKW ?? ""}
                    onChange={(e) => setNum(s.id, "capacityKW", e.target.value)}
                  />
                )}
              {s.kind === "chp" && (
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label={msg("lblSystemThermalKW")}
                  value={s.thermalCapacityKW ?? ""}
                  onChange={(e) => setNum(s.id, "thermalCapacityKW", e.target.value)}
                />
              )}
              <TextField
                fullWidth
                size="small"
                type="number"
                label={msg("lblCommissioningYear")}
                value={s.commissioningYear ?? ""}
                onChange={(e) => setNum(s.id, "commissioningYear", e.target.value)}
              />
              <TextField
                fullWidth
                size="small"
                label={msg("lblSystemOperator")}
                value={s.operatedBy ?? ""}
                onChange={(e) => setText(s.id, "operatedBy", e.target.value)}
              />
            </Stack>
          </Box>
        ))}
        <Stack direction="row" spacing={1}>
          <Button size="small" startIcon={<AddIcon />} onClick={() => addUnit("pv")}>
            {msg("btnAddPv")}
          </Button>
          <Button size="small" startIcon={<AddIcon />} onClick={() => addUnit("battery")}>
            {msg("btnAddBattery")}
          </Button>
          <Button size="small" startIcon={<AddIcon />} onClick={() => addUnit("chp")}>
            {msg("btnAddChp")}
          </Button>
        </Stack>
      </Stack>
    </Modal>
  );
}

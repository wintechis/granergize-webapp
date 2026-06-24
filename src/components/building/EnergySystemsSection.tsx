import { msg } from "../../lib/messages.ts";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import type { BuildingType, SystemKind, TechnicalSystem } from "../../types.ts";
import { AgentLabel } from "../AgentLabel.tsx";
import { DetailRow } from "../detail/DetailView.tsx";
import { useNotification } from "../../context/NotificationContext.tsx";
import { useUpdateBuilding } from "../../hooks/mutations.ts";
import { buildingFileUri } from "../../services/rdf/building/buildingId.ts";

/** The unit's kind label ("PV system" / "Battery storage" / "Cogeneration (CHP)"). */
const kindLabel = (kind: SystemKind): string =>
  kind === "battery"
    ? msg("mdBatteryStorage")
    : kind === "chp"
    ? msg("mdChpSystem")
    : msg("mdPvSystem");

/** One-line capacity summary ("750 kW, since 2018" / "215.5 kWh" / "61 kW el, 126 kW
 * th, since 2017"), or "Yes" when present but undetailed. */
const systemSummary = (s: TechnicalSystem): string => {
  const parts: string[] = [];
  if (s.capacityKW != null) parts.push(`${s.capacityKW} kW${s.kind === "chp" ? " el" : ""}`);
  if (s.storageCapacityKWh != null) parts.push(`${s.storageCapacityKWh} kWh`);
  if (s.thermalCapacityKW != null) parts.push(`${s.thermalCapacityKW} kW th`);
  if (s.commissioningYear != null) parts.push(`since ${s.commissioningYear}`);
  return parts.length ? parts.join(", ") : "Yes";
};

/**
 * The inline editor — the same unit list the Edit dialog offered, but on the page (mirrors
 * `MasterDataSection`'s inline editor). A building may carry SEVERAL of a kind, so this is a
 * list editor: each unit a card with a stable `id` (kept across edits so a per-unit
 * observation's feature-of-interest stays valid). The whole list is submitted via
 * {@link useUpdateBuilding}'s `systems` param → `replaceSystems`; master-data fields are
 * untouched (an empty `fields` map).
 */
function EditView(
  { building, onDone }: { building: BuildingType; onDone: () => void },
) {
  const { showNotification } = useNotification();
  const initial = useMemo(
    () => ((building.systems ?? []) as TechnicalSystem[]).map((s) => ({ ...s })),
    [building],
  );
  const [systems, setSystems] = useState<TechnicalSystem[]>(initial);
  // Re-seed on a same-building refetch while the form is pristine — a save closes the
  // editor + refetches, so reopening before that lands would otherwise show stale units
  // (the `key` is the URI, stable across refetch, so the mount-time seed never re-runs).
  const lastSeedRef = useRef(initial);
  useEffect(() => {
    const prev = lastSeedRef.current;
    if (initial === prev) return;
    lastSeedRef.current = initial;
    setSystems((cur) => (cur === prev ? initial : cur));
  }, [initial]);
  const update = useUpdateBuilding();
  const saving = update.isPending;
  const fileUri = building.sourceUri ?? buildingFileUri(building.uri as string);

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

  const handleSave = () =>
    update.mutate(
      { fileUri, subjectUri: building.uri as string, fields: {}, systems },
      {
        onSuccess: () => {
          showNotification(msg("buildingUpdated"), "success");
          onDone();
        },
      },
    );

  return (
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
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Button onClick={onDone} disabled={saving}>{msg("btnCancel")}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? msg("btnSaving") : msg("btnSave")}
        </Button>
      </Stack>
    </Stack>
  );
}

/**
 * The building's energy units (PV plants, batteries, CHP) — shown on the building page
 * and managed here (NOT in the create-building form). Read-first: each unit renders as a
 * summary row; an [Edit]/[Add] button flips the list to an INLINE editor on the page (no
 * modal — mirroring Master data). A building may carry several of a kind; each is a
 * `bldg:hasSystem` node. An owned building can add/edit them, a shared one is read-only.
 */
export default function EnergySystemsSection(
  { building }: { building: BuildingType },
) {
  const canEdit = !building.isShared;
  const [editing, setEditing] = useState(false);
  const systems = (building.systems ?? []) as TechnicalSystem[];
  const hasAny = systems.length > 0;

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
      >
        <Typography variant="h6">{msg("secEnergySystems")}</Typography>
        {canEdit && !editing && (
          <Button
            size="small"
            startIcon={hasAny ? <EditIcon fontSize="small" /> : <AddIcon fontSize="small" />}
            onClick={() => setEditing(true)}
          >
            {hasAny ? msg("btnEdit") : msg("btnAddSystem")}
          </Button>
        )}
      </Stack>

      {editing
        ? (
          <EditView
            key={building.uri as string}
            building={building}
            onDone={() => setEditing(false)}
          />
        )
        : hasAny
        ? (
          <Stack spacing={1}>
            {systems.map((s) => (
              <Fragment key={s.id}>
                <DetailRow label={kindLabel(s.kind)} value={systemSummary(s)} />
                {s.operatedBy && (
                  <DetailRow
                    label={msg("mdSystemOperator")}
                    value={<AgentLabel value={s.operatedBy} />}
                  />
                )}
              </Fragment>
            ))}
          </Stack>
        )
        : (
          <Typography variant="body2" color="text.secondary">
            {canEdit ? msg("energySystemsEmpty") : msg("energySystemsEmptyShared")}
          </Typography>
        )}
    </Box>
  );
}

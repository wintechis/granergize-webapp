import { msg, type MessageId } from "../../lib/messages.ts";
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
import type { Building, SystemKind, TechnicalSystem } from "../../types.ts";
import { isHeatKind } from "../../types.ts";
import { AgentLabel } from "../AgentLabel.tsx";
import { DetailRow } from "../detail/DetailView.tsx";
import { useNotification } from "../../context/NotificationContext.tsx";
import { useUpdateBuilding } from "../../hooks/mutations.ts";
import { buildingFileUri } from "../../services/rdf/building/buildingId.ts";

/** The two presentation sections over the ONE `bldg:hasSystem` list. Energy systems
 *  (PV / battery / CHP) and heat generation (heat pump / boilers / district heating) are
 *  all `:TechnicalSystem` nodes; they're split here only for the UI. */
type Group = "energy" | "heat";

interface GroupConfig {
  title: MessageId;
  empty: MessageId;
  emptyShared: MessageId;
  addBtn: MessageId;
  /** The kinds this section offers to add, each with its "Add …" button label. */
  add: { kind: SystemKind; label: MessageId }[];
}

const GROUPS: Record<Group, GroupConfig> = {
  energy: {
    title: "secEnergySystems",
    empty: "energySystemsEmpty",
    emptyShared: "energySystemsEmptyShared",
    addBtn: "btnAddSystem",
    add: [
      { kind: "pv", label: "btnAddPv" },
      { kind: "battery", label: "btnAddBattery" },
      { kind: "chp", label: "btnAddChp" },
    ],
  },
  heat: {
    title: "secHeatGeneration",
    empty: "heatGenerationEmpty",
    emptyShared: "heatGenerationEmptyShared",
    addBtn: "btnAddHeatGenerator",
    add: [
      { kind: "heatpump", label: "btnAddHeatPump" },
      { kind: "gasboiler", label: "btnAddGasBoiler" },
      { kind: "districtheating", label: "btnAddDistrictHeating" },
      { kind: "oilboiler", label: "btnAddOilBoiler" },
      { kind: "electricboiler", label: "btnAddElectricBoiler" },
    ],
  },
};

/** Whether a kind belongs to a section (heat → the heat kinds; energy → the rest). */
const inGroup = (group: Group, kind: SystemKind): boolean =>
  group === "heat" ? isHeatKind(kind) : !isHeatKind(kind);

/** The kind's display label (reuses the master-data heat labels). */
const kindLabel = (kind: SystemKind): string =>
  msg(
    kind === "battery"
      ? "mdBatteryStorage"
      : kind === "chp"
      ? "mdChpSystem"
      : kind === "pv"
      ? "mdPvSystem"
      : kind === "heatpump"
      ? "mdHeatPump"
      : kind === "gasboiler"
      ? "mdGasBoiler"
      : kind === "districtheating"
      ? "mdDistrictHeating"
      : kind === "oilboiler"
      ? "mdOilBoiler"
      : "mdElectricBoiler",
  );

/** One-line capacity summary ("750 kW, since 2018" / "215.5 kWh" / "120 kW th, since
 * 2019"), or "Yes" when present but undetailed. */
const systemSummary = (s: TechnicalSystem): string => {
  const parts: string[] = [];
  if (s.capacityKW != null) parts.push(`${s.capacityKW} kW${s.kind === "chp" ? " el" : ""}`);
  if (s.storageCapacityKWh != null) parts.push(`${s.storageCapacityKWh} kWh`);
  if (s.thermalCapacityKW != null) parts.push(`${s.thermalCapacityKW} kW th`);
  if (s.commissioningYear != null) parts.push(`since ${s.commissioningYear}`);
  return parts.length ? parts.join(", ") : "Yes";
};

/** The capacity field(s) a kind shows: heat → thermal kW; battery → kWh; PV → kW;
 * CHP → electrical kW + thermal kW. */
function CapacityFields(
  { s, setNum }: {
    s: TechnicalSystem;
    setNum: (id: string, key: keyof TechnicalSystem, raw: string) => void;
  },
) {
  if (isHeatKind(s.kind)) {
    return (
      <TextField
        fullWidth
        size="small"
        type="number"
        label={msg("lblSystemThermalKW")}
        value={s.thermalCapacityKW ?? ""}
        onChange={(e) => setNum(s.id, "thermalCapacityKW", e.target.value)}
      />
    );
  }
  if (s.kind === "battery") {
    return (
      <TextField
        fullWidth
        size="small"
        type="number"
        label={msg("lblSystemCapacityKWh")}
        value={s.storageCapacityKWh ?? ""}
        onChange={(e) => setNum(s.id, "storageCapacityKWh", e.target.value)}
      />
    );
  }
  return (
    <>
      <TextField
        fullWidth
        size="small"
        type="number"
        label={msg("lblSystemCapacityKW")}
        value={s.capacityKW ?? ""}
        onChange={(e) => setNum(s.id, "capacityKW", e.target.value)}
      />
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
    </>
  );
}

/**
 * The inline list editor for ONE section's units (mirrors `MasterDataSection`'s inline
 * editor). Seeds from this group's systems; on save it submits the WHOLE `systems` list —
 * this group's edits plus the OTHER group's nodes verbatim — so editing Energy systems
 * never drops Heat generation (and vice versa). Master-data fields stay untouched (empty
 * `fields`).
 */
function EditView(
  { building, group, onDone }: {
    building: Building;
    group: Group;
    onDone: () => void;
  },
) {
  const cfg = GROUPS[group];
  const { showNotification } = useNotification();
  const all = (building.systems ?? []) as TechnicalSystem[];
  const initial = useMemo(
    () =>
      ((building.systems ?? []) as TechnicalSystem[])
        .filter((s) => inGroup(group, s.kind))
        .map((s) => ({ ...s })),
    [building, group],
  );
  const [systems, setSystems] = useState<TechnicalSystem[]>(initial);
  // Re-seed on a same-building refetch while pristine (the `key` is the URI, stable across
  // refetch, so the mount-time seed never re-runs) — see MasterDataSection.
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
      {
        fileUri,
        subjectUri: building.uri as string,
        fields: {},
        // The other section's units, untouched, plus this section's edited list.
        systems: [...all.filter((s) => !inGroup(group, s.kind)), ...systems],
      },
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
        <Typography variant="body2" color="text.secondary">{msg(cfg.empty)}</Typography>
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
            <CapacityFields s={s} setNum={setNum} />
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
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
        {cfg.add.map((a) => (
          <Button
            key={a.kind}
            size="small"
            startIcon={<AddIcon />}
            onClick={() => addUnit(a.kind)}
          >
            {msg(a.label)}
          </Button>
        ))}
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
 * One section of the building's technical systems — `group="energy"` (PV / battery / CHP)
 * or `group="heat"` (heat pump / boilers / district heating). Both render the same way
 * (read-first summary rows; an `[Edit]`/`[Add]` flip to an inline editor, no modal — like
 * Master data) over the one `bldg:hasSystem` list, each showing only its own kinds. An
 * owned building can add/edit; a shared one is read-only.
 */
export default function SystemListSection(
  { building, group }: { building: Building; group: Group },
) {
  const cfg = GROUPS[group];
  const canEdit = !building.isShared;
  const [editing, setEditing] = useState(false);
  const systems = ((building.systems ?? []) as TechnicalSystem[])
    .filter((s) => inGroup(group, s.kind));
  const hasAny = systems.length > 0;

  return (
    <Box>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
      >
        <Typography variant="h6">{msg(cfg.title)}</Typography>
        {canEdit && !editing && (
          <Button
            size="small"
            startIcon={hasAny ? <EditIcon fontSize="small" /> : <AddIcon fontSize="small" />}
            onClick={() => setEditing(true)}
          >
            {hasAny ? msg("btnEdit") : msg(cfg.addBtn)}
          </Button>
        )}
      </Stack>

      {editing
        ? (
          <EditView
            key={building.uri as string}
            building={building}
            group={group}
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
            {canEdit ? msg(cfg.empty) : msg(cfg.emptyShared)}
          </Typography>
        )}
    </Box>
  );
}

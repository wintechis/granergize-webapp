import { msg } from "../../lib/messages.ts";
import { useState } from "react";
import { Button, Stack, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import type {
  BatteryStorage,
  BuildingType,
  ChpSystem,
  PvSystem,
} from "../../types.ts";
import { AgentLabel } from "../AgentLabel.tsx";
import { DetailRow } from "../detail/DetailView.tsx";
import EnergySystemsDialog from "./EnergySystemsDialog.tsx";

/** One-line summary of the PV plant ("750 kW, since 2018"), or "Yes" when present
 * but undetailed. The operator is shown as its own resolved-agent row. */
const pvSystemSummary = (pv: PvSystem): string => {
  const parts: string[] = [];
  if (pv.capacityKW != null) parts.push(`${pv.capacityKW} kW`);
  if (pv.commissioningYear != null) parts.push(`since ${pv.commissioningYear}`);
  return parts.length ? parts.join(", ") : "Yes";
};

/** One-line summary of the battery ("215.5 kWh, since 2021"), else "Yes". */
const batterySummary = (b: BatteryStorage): string => {
  const parts: string[] = [];
  if (b.capacityKWh != null) parts.push(`${b.capacityKWh} kWh`);
  if (b.commissioningYear != null) parts.push(`since ${b.commissioningYear}`);
  return parts.length ? parts.join(", ") : "Yes";
};

/** One-line summary of the CHP plant ("61 kW el, 126 kW th, since 2017"), else "Yes". */
const chpSummary = (c: ChpSystem): string => {
  const parts: string[] = [];
  if (c.capacityKW != null) parts.push(`${c.capacityKW} kW el`);
  if (c.thermalCapacityKW != null) parts.push(`${c.thermalCapacityKW} kW th`);
  if (c.commissioningYear != null) parts.push(`since ${c.commissioningYear}`);
  return parts.length ? parts.join(", ") : "Yes";
};

/**
 * The building's energy systems (units) — PV plant, battery storage, CHP — shown on
 * the building page and managed here (NOT in the create-building form), so units are
 * added/edited on the building's own page. Each is a `bldg:hasSystem` technical-system
 * node; an owned building can add them, a shared one is read-only.
 */
export default function EnergySystemsSection(
  { building }: { building: BuildingType },
) {
  const canEdit = !building.isShared;
  const [editing, setEditing] = useState(false);
  const hasAny = !!(building.pvSystem || building.batteryStorage || building.chpSystem);

  return (
    <>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", mb: 1 }}
      >
        <Typography variant="h6">{msg("secEnergySystems")}</Typography>
        {canEdit && (
          <Button
            size="small"
            startIcon={hasAny ? <EditIcon fontSize="small" /> : <AddIcon fontSize="small" />}
            onClick={() => setEditing(true)}
          >
            {hasAny ? msg("btnEdit") : msg("btnAddSystem")}
          </Button>
        )}
      </Stack>

      {hasAny
        ? (
          <Stack spacing={1}>
            {building.pvSystem && (
              <DetailRow label={msg("mdPvSystem")} value={pvSystemSummary(building.pvSystem)} />
            )}
            {building.pvSystem?.operatedBy && (
              <DetailRow
                label={msg("mdPvOperator")}
                value={<AgentLabel value={building.pvSystem.operatedBy} />}
              />
            )}
            {building.batteryStorage && (
              <DetailRow
                label={msg("mdBatteryStorage")}
                value={batterySummary(building.batteryStorage)}
              />
            )}
            {building.batteryStorage?.operatedBy && (
              <DetailRow
                label={msg("mdBatteryOperator")}
                value={<AgentLabel value={building.batteryStorage.operatedBy} />}
              />
            )}
            {building.chpSystem && (
              <DetailRow label={msg("mdChpSystem")} value={chpSummary(building.chpSystem)} />
            )}
            {building.chpSystem?.operatedBy && (
              <DetailRow
                label={msg("mdChpOperator")}
                value={<AgentLabel value={building.chpSystem.operatedBy} />}
              />
            )}
          </Stack>
        )
        : (
          <Typography variant="body2" color="text.secondary">
            {canEdit ? msg("energySystemsEmpty") : msg("energySystemsEmptyShared")}
          </Typography>
        )}

      {editing && (
        <EnergySystemsDialog
          open={editing}
          building={building}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

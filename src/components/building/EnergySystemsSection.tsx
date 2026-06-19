import { msg } from "../../lib/messages.ts";
import { Fragment, useState } from "react";
import { Button, Stack, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import AddIcon from "@mui/icons-material/Add";
import type { BuildingType, SystemKind, TechnicalSystem } from "../../types.ts";
import { AgentLabel } from "../AgentLabel.tsx";
import { DetailRow } from "../detail/DetailView.tsx";
import EnergySystemsDialog from "./EnergySystemsDialog.tsx";

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
 * The building's energy units (PV plants, batteries, CHP) — shown on the building page
 * and managed here (NOT in the create-building form). A building may carry several of
 * a kind; each is a `bldg:hasSystem` node. An owned building can add/edit them, a shared
 * one is read-only.
 */
export default function EnergySystemsSection(
  { building }: { building: BuildingType },
) {
  const canEdit = !building.isShared;
  const [editing, setEditing] = useState(false);
  const systems = (building.systems ?? []) as TechnicalSystem[];
  const hasAny = systems.length > 0;

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

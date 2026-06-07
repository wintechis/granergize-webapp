import { useState } from "react";
import { Button, MenuItem, Stack, TextField } from "@mui/material";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { BuildingType, Scenario } from "../types.ts";
import type {
  AnnualMetrics,
  EnergyMetricKey,
} from "../services/utils/energyDataset.ts";
import { writeEnergyYear } from "../services/utils/buildingSerializer.ts";
import { useInvalidateBuildingData } from "../hooks/mutations.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { formatError } from "../services/utils/formatError.ts";
import Modal from "./Modal.tsx";

const METRIC_FIELDS: Array<{ key: EnergyMetricKey; label: string }> = [
  { key: "electricityConsumption", label: "Electricity (kWh)" },
  { key: "heatConsumption", label: "Heat (kWh)" },
  { key: "waterConsumption", label: "Water (m³)" },
  { key: "wastewaterConsumption", label: "Wastewater (m³)" },
  { key: "renewableSelfGeneratedShare", label: "Renewable self-generated share (%)" },
];

interface EnergyYearDialogProps {
  open: boolean;
  building: BuildingType;
  session: Session;
  onClose: () => void;
}

/**
 * Add (or overwrite) one year of annual energy figures for a building, as a
 * `gran:EnergyDataset` resource — choosing the *actual* readings or the
 * *planned* (Soll) figures (#16). Each (year, scenario) is its own resource, so
 * adding/editing a year doesn't touch the others (#5).
 */
export default function EnergyYearDialog(
  { open, building, session, onClose }: EnergyYearDialogProps,
) {
  const reload = useInvalidateBuildingData();
  const { showNotification } = useNotification();

  const [year, setYear] = useState("");
  const [scenario, setScenario] = useState<Scenario>("actual");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const dirty = year.trim() !== "" ||
    Object.values(values).some((v) => v.trim() !== "");

  const reset = () => {
    setYear("");
    setScenario("actual");
    setValues({});
  };
  const close = () => {
    reset();
    onClose();
  };

  const handleSave = async () => {
    const y = parseInt(year);
    if (!Number.isInteger(y) || y < 1900 || y > 2100) {
      showNotification("Enter a valid year", "error");
      return;
    }
    const metrics: AnnualMetrics = {};
    for (const { key } of METRIC_FIELDS) {
      const raw = values[key];
      if (raw && raw.trim() !== "") {
        const n = parseFloat(raw);
        if (!isNaN(n)) metrics[key] = n;
      }
    }
    if (Object.keys(metrics).length === 0) {
      showNotification("Enter at least one figure", "error");
      return;
    }

    setBusy(true);
    try {
      const subjectUri = building.uri as string;
      await writeEnergyYear(session, subjectUri.split("#")[0], subjectUri, {
        building: subjectUri,
        year: y,
        granularity: "P1Y",
        scenario,
        metrics,
      });
      reload();
      showNotification("Energy data saved", "success");
      close();
    } catch (err) {
      showNotification(formatError("save energy data", err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add / edit energy year"
      dirty={dirty}
      busy={busy}
      actions={
        <>
          <Button variant="text" onClick={close} disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Stack spacing={2} sx={{ mt: 1 }}>
        <TextField
          label="Year"
          type="number"
          size="small"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
        <TextField
          select
          label="Scenario"
          size="small"
          value={scenario}
          onChange={(e) => setScenario(e.target.value as Scenario)}
        >
          <MenuItem value="actual">Actual</MenuItem>
          <MenuItem value="planned">Planned (Soll)</MenuItem>
        </TextField>
        {METRIC_FIELDS.map(({ key, label }) => (
          <TextField
            key={key}
            label={label}
            type="number"
            size="small"
            value={values[key] ?? ""}
            onChange={(e) =>
              setValues((v) => ({ ...v, [key]: e.target.value }))}
          />
        ))}
      </Stack>
    </Modal>
  );
}

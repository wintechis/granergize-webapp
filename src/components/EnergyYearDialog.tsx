import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { Session } from "@inrupt/solid-client-authn-browser";
import type { BuildingType, Scenario } from "../types.ts";
import {
  type AnnualMetrics,
  type EnergyDataset,
  type EnergyMetricKey,
  loadEnergyDatasets,
} from "../services/utils/energyDataset.ts";
import {
  deleteEnergyYear,
  writeEnergyYear,
} from "../services/utils/buildingSerializer.ts";
import { useInvalidateBuildingData } from "../hooks/mutations.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { formatError } from "../services/utils/formatError.ts";
import { logError } from "../services/utils/logError.ts";
import Modal from "./Modal.tsx";

const METRIC_FIELDS: Array<
  { key: EnergyMetricKey; label: string; short: string; decimals: number }
> = [
  { key: "electricityConsumption", label: "Electricity (kWh)", short: "Electricity", decimals: 0 },
  { key: "heatConsumption", label: "Heat (kWh)", short: "Heat", decimals: 0 },
  { key: "waterConsumption", label: "Water (m³)", short: "Water", decimals: 1 },
  { key: "wastewaterConsumption", label: "Wastewater (m³)", short: "Wastewater", decimals: 1 },
  {
    key: "renewableSelfGeneratedShare",
    label: "Renewable self-generated share (%)",
    short: "Renewable %",
    decimals: 1,
  },
];

const fmt = (value: number, decimals: number): string =>
  new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);

const scenarioLabel = (s: Scenario): string =>
  s === "planned" ? "Planned (Soll)" : "Actual";

/** Stable key for one (year, scenario) annual dataset. */
const dsKey = (year: number, scenario: Scenario): string => `${year}|${scenario}`;

interface EnergyYearDialogProps {
  open: boolean;
  building: BuildingType;
  session: Session;
  onClose: () => void;
}

/**
 * Add, edit or remove the annual energy figures for a building. Each (year,
 * scenario) is its own `gran:EnergyDataset` resource — choosing the *actual*
 * readings or the *planned* (Soll) figures (#16) — so touching one doesn't affect
 * the others (#5). A table at the top lists the years already stored (the
 * read-back of what you entered); a row's Edit loads it back into the form, and
 * Delete removes that year. Saving keeps the dialog open so the table reflects
 * the change immediately.
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
  const [editingExisting, setEditingExisting] = useState(false);

  // The annual (P1Y) datasets currently stored for this building, with their
  // figures — the source of both the read-back table and the edit pre-fill. Seeded
  // from the Pod when the dialog opens and kept in sync as the user saves/deletes,
  // so the table updates without waiting for a buildings refetch.
  const [datasets, setDatasets] = useState<EnergyDataset[]>([]);
  const [listLoading, setListLoading] = useState(true);

  const dirty = year.trim() !== "" ||
    Object.values(values).some((v) => v.trim() !== "");

  // (year, scenario) → stored dataset, for the edit pre-fill lookup.
  const existingByKey = useMemo(
    () => new Map(datasets.map((d) => [dsKey(d.year, d.scenario), d] as const)),
    [datasets],
  );

  // Load the building's stored annual datasets once per open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setListLoading(true);
    const refs = (building.energyDatasets ?? []).filter(
      (r) => r.granularity === "P1Y",
    );
    loadEnergyDatasets(refs, session.fetch.bind(session))
      .then((loaded) => {
        if (!cancelled) setDatasets(loaded);
      })
      .catch((err) => logError("load annual energy datasets", err))
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, building.id]);

  // The (year, scenario) currently reflected in the form from a load, so a
  // re-render doesn't clobber what the user has edited.
  const loadedKey = useRef<string | null>(null);

  // When the typed year+scenario matches a stored dataset, pre-fill its figures
  // (so editing one metric doesn't overwrite the untouched ones with nothing, #5).
  useEffect(() => {
    const y = parseInt(year);
    if (!Number.isInteger(y)) return;
    const key = dsKey(y, scenario);
    if (key === loadedKey.current) return;
    const ds = existingByKey.get(key);
    if (!ds) {
      // A year with no stored dataset — a fresh entry; don't touch the fields.
      setEditingExisting(false);
      return;
    }
    loadedKey.current = key;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(ds.metrics ?? {})) next[k] = String(v);
    setValues(next);
    setEditingExisting(true);
  }, [year, scenario, existingByKey]);

  const reset = () => {
    setYear("");
    setScenario("actual");
    setValues({});
    setEditingExisting(false);
    loadedKey.current = null;
  };
  const close = () => {
    reset();
    onClose();
  };

  /** Load a stored year back into the form for editing. */
  const editYear = (d: EnergyDataset) => {
    loadedKey.current = dsKey(d.year, d.scenario);
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(d.metrics ?? {})) next[k] = String(v);
    setValues(next);
    setYear(String(d.year));
    setScenario(d.scenario);
    setEditingExisting(true);
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
      // Reflect the saved year in the table without a round-trip, then clear the
      // form so the user can see it land and add/edit another.
      setDatasets((prev) => {
        const rest = prev.filter((d) => dsKey(d.year, d.scenario) !== dsKey(y, scenario));
        return [...rest, { building: subjectUri, year: y, granularity: "P1Y", scenario, metrics }];
      });
      reload();
      showNotification("Energy data saved", "success");
      reset();
    } catch (err) {
      showNotification(formatError("save energy data", err), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (d: EnergyDataset) => {
    if (
      !globalThis.confirm(
        `Delete the ${scenarioLabel(d.scenario)} figures for ${d.year}?`,
      )
    ) return;
    setBusy(true);
    try {
      const subjectUri = building.uri as string;
      await deleteEnergyYear(session, subjectUri.split("#")[0], subjectUri, {
        year: d.year,
        granularity: "P1Y",
        scenario: d.scenario,
      });
      setDatasets((prev) =>
        prev.filter((x) => dsKey(x.year, x.scenario) !== dsKey(d.year, d.scenario))
      );
      // If the deleted year was loaded in the form, clear it.
      if (loadedKey.current === dsKey(d.year, d.scenario)) reset();
      reload();
      showNotification("Energy year deleted", "success");
    } catch (err) {
      showNotification(formatError("delete energy data", err), "error");
    } finally {
      setBusy(false);
    }
  };

  const sorted = [...datasets].sort((a, b) =>
    a.year - b.year || a.scenario.localeCompare(b.scenario)
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title="Energy years"
      maxWidth="md"
      dirty={dirty}
      busy={busy}
      actions={
        <>
          <Button variant="text" onClick={close} disabled={busy}>Close</Button>
          <Button variant="contained" onClick={handleSave} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Stack spacing={3} sx={{ mt: 1 }}>
        {/* Read-back of what's stored for this building. */}
        <section>
          <Typography variant="h6" sx={{ mb: 1 }}>Stored years</Typography>
          {listLoading
            ? <Typography color="text.secondary">Loading…</Typography>
            : sorted.length === 0
            ? (
              <Typography color="text.secondary">
                No energy years entered yet.
              </Typography>
            )
            : (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>Year</strong></TableCell>
                      <TableCell><strong>Scenario</strong></TableCell>
                      {METRIC_FIELDS.map((m) => (
                        <TableCell key={m.key} align="right">
                          <strong>{m.short}</strong>
                        </TableCell>
                      ))}
                      <TableCell align="right" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sorted.map((d) => (
                      <TableRow hover key={dsKey(d.year, d.scenario)}>
                        <TableCell>{d.year}</TableCell>
                        <TableCell>{scenarioLabel(d.scenario)}</TableCell>
                        {METRIC_FIELDS.map((m) => {
                          const v = d.metrics?.[m.key];
                          return (
                            <TableCell key={m.key} align="right">
                              {v != null ? fmt(v, m.decimals) : "—"}
                            </TableCell>
                          );
                        })}
                        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                          <Tooltip title="Edit this year">
                            <IconButton
                              size="small"
                              aria-label="Edit this year"
                              onClick={() => editYear(d)}
                              disabled={busy}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete this year">
                            <IconButton
                              size="small"
                              color="error"
                              aria-label="Delete this year"
                              onClick={() => handleDelete(d)}
                              disabled={busy}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
        </section>

        {/* Add / edit one year. */}
        <section>
          <Typography variant="h6" sx={{ mb: 1 }}>
            {editingExisting ? "Edit year" : "Add a year"}
          </Typography>
          <Stack spacing={2}>
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
            {editingExisting && (
              <Typography variant="body2" color="text.secondary">
                Editing existing figures for this year — change only what you need;
                the rest are kept.
              </Typography>
            )}
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
        </section>
      </Stack>
    </Modal>
  );
}

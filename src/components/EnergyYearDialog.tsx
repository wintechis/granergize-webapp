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
} from "../services/rdf/energyDataset.ts";
import { buildingFileUri } from "../services/rdf/building/buildingId.ts";
import {
  useDeleteEnergyYear,
  useWriteEnergyYear,
} from "../hooks/mutations.ts";
import { energyKeyFor } from "../hooks/queries.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useConfirm } from "../context/ConfirmContext.tsx";
import { logError } from "../lib/logError.ts";
import Modal from "./Modal.tsx";
import { BuildingDialogTitle } from "./BuildingDialogTitle.tsx";
import { ANNUAL_METRICS } from "../constants/annualMetrics.ts";

// Derived from the shared annual-metric schema (constants/annualMetrics.ts) so
// the entry form and the view dialogs can't drift on the metric set/labels.
const METRIC_FIELDS: Array<
  { key: EnergyMetricKey; label: string; short: string; decimals: number }
> = ANNUAL_METRICS.map((m) => ({
  key: m.key,
  label: `${m.label} (${m.unit})`,
  short: m.short,
  decimals: m.decimals,
}));

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
 * scenario) is its own `cons:EnergyDataset` resource — choosing the *actual*
 * readings or the *planned* (Soll) figures (#16) — so touching one doesn't affect
 * the others (#5). A table at the top lists the years already stored (the
 * read-back of what you entered); a row's Edit loads it back into the form, and
 * Delete removes that year. Saving keeps the dialog open so the table reflects
 * the change immediately.
 */
export default function EnergyYearDialog(
  { open, building, session, onClose }: EnergyYearDialogProps,
) {
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();
  // Busy state, error toasts (central, classified) and the building-data
  // invalidations come from the hooks; the dialog owns the form + read-back UI.
  const write = useWriteEnergyYear();
  const del = useDeleteEnergyYear();
  const busy = write.isPending || del.isPending;

  const [year, setYear] = useState("");
  const [scenario, setScenario] = useState<Scenario>("actual");
  const [values, setValues] = useState<Record<string, string>>({});
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

  // Load the building's stored annual datasets per open — re-seeded when the
  // building's dataset LINKS change (the `energyKeyFor` fingerprint): the parent
  // passes the live building, so a year saved moments before opening can land
  // via the buildings refetch while the dialog is already showing and still
  // appear in the table (the click-time building object would miss it forever).
  const refsKey = energyKeyFor([building]);
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
  }, [open, building.id, refsKey]);

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
      // No stored dataset for this (year, scenario). If we were showing a
      // previously-loaded dataset, the user has navigated to an empty slot
      // (a different scenario or year) — clear the figures so the loaded ones
      // don't leak across (#5, e.g. Soll showing the Ist values). If nothing was
      // loaded, this is a fresh entry being typed — leave the fields untouched.
      if (loadedKey.current !== null) {
        setValues({});
        loadedKey.current = null;
      }
      setEditingExisting(false);
      return;
    }
    // Don't clobber live typing: the stored-years list loads asynchronously
    // after open, so this effect can re-fire (existingByKey dep) AFTER the user
    // already typed figures for this slot — pre-filling then would silently
    // overwrite their input with the stored values. A fresh entry in progress
    // (nothing loaded, fields non-empty) keeps the user's figures; the "editing
    // existing figures" hint still appears so they know stored values exist.
    if (
      loadedKey.current === null &&
      Object.values(values).some((v) => v.trim() !== "")
    ) {
      setEditingExisting(true);
      return;
    }
    loadedKey.current = key;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(ds.metrics ?? {})) next[k] = String(v);
    setValues(next);
    setEditingExisting(true);
    // `values` is a real dep (the live-typing guard reads it); re-fires per
    // keystroke but the loadedKey/early-return guards make that a no-op.
  }, [year, scenario, existingByKey, values]);

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
    for (const { key, label } of METRIC_FIELDS) {
      const raw = values[key];
      if (raw && raw.trim() !== "") {
        const n = parseFloat(raw);
        // Reject, don't skip: silently dropping an unparseable figure (e.g. a
        // German "1,5" decimal comma — the read-back table itself formats
        // de-DE, inviting commas) would, when EDITING a stored year, silently
        // DELETE that metric from the PUT.
        if (isNaN(n)) {
          showNotification(
            `"${raw}" is not a number (${label}) — use a dot as the decimal separator`,
            "error",
          );
          return;
        }
        metrics[key] = n;
      }
    }
    if (Object.keys(metrics).length === 0) {
      showNotification("Enter at least one figure", "error");
      return;
    }

    const subjectUri = building.uri as string;
    const dataset = {
      building: subjectUri,
      year: y,
      granularity: "P1Y",
      scenario,
      metrics,
    };
    write.mutate(
      { fileUri: buildingFileUri(subjectUri), subjectUri, dataset },
      {
        onSuccess: () => {
          // Reflect the saved year in the table without a round-trip, then clear
          // the form so the user can see it land and add/edit another.
          setDatasets((prev) => {
            const rest = prev.filter(
              (d) => dsKey(d.year, d.scenario) !== dsKey(y, scenario),
            );
            return [...rest, dataset];
          });
          showNotification("Energy data saved", "success");
          // Clear year/figures but KEEP the scenario: entering several planned
          // (Soll) years in a row shouldn't need re-selecting "Planned" each time.
          const keep = scenario;
          reset();
          setScenario(keep);
        },
      },
    );
  };

  const handleDelete = async (d: EnergyDataset) => {
    if (
      !await confirm({
        title: "Delete energy data",
        message: `Delete the ${scenarioLabel(d.scenario)} figures for ${d.year}?`,
        confirmLabel: "Delete",
      })
    ) return;
    const subjectUri = building.uri as string;
    del.mutate(
      {
        fileUri: buildingFileUri(subjectUri),
        subjectUri,
        dataset: { year: d.year, granularity: "P1Y", scenario: d.scenario },
      },
      {
        onSuccess: () => {
          setDatasets((prev) =>
            prev.filter(
              (x) => dsKey(x.year, x.scenario) !== dsKey(d.year, d.scenario),
            )
          );
          // If the deleted year was loaded in the form, clear it.
          if (loadedKey.current === dsKey(d.year, d.scenario)) reset();
          showNotification("Energy year deleted", "success");
        },
      },
    );
  };

  const sorted = [...datasets].sort((a, b) =>
    a.year - b.year || a.scenario.localeCompare(b.scenario)
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title={<BuildingDialogTitle building={building} action="Energy years" />}
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

import { msg } from "../lib/messages.ts";
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
import type {
  BuildingType,
  Scenario,
  SystemKind,
  TechnicalSystem,
} from "../types.ts";
import { useQueryClient } from "@tanstack/react-query";
import {
  type AnnualMetrics,
  type EnergyDataset,
  type EnergyMetricKey,
} from "../services/rdf/energyDataset.ts";
import { buildingFileUri } from "../services/rdf/building/buildingId.ts";
import BuildingPicker from "./BuildingPicker.tsx";
import {
  useDeleteEnergyYear,
  useWriteEnergyYear,
} from "../hooks/mutations.ts";
import { queryKeys, useAnnualDatasets } from "../hooks/queries.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useConfirm } from "../context/ConfirmContext.tsx";
import Modal from "./Modal.tsx";
import { BuildingDialogTitle } from "./BuildingDialogTitle.tsx";
import { annualMetricLabel, ANNUAL_METRICS } from "../constants/annualMetrics.ts";

// Derived from the shared annual-metric schema (constants/annualMetrics.ts) so
// the entry form and the view dialogs can't drift on the metric set/labels.
// A function (not a const) so the labels resolve in the ACTIVE language on each
// render — the full label comes from the vocab, the short form from the catalog.
function metricFields(): Array<
  { key: EnergyMetricKey; label: string; short: string; decimals: number }
> {
  return ANNUAL_METRICS.map((m) => ({
    key: m.key,
    label: annualMetricLabel(m.key),
    short: msg(m.shortId),
    decimals: m.decimals,
  }));
}

const fmt = (value: number, decimals: number): string =>
  new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);

const scenarioLabel = (s: Scenario): string =>
  s === "planned" ? msg("scenarioPlanned") : msg("scenarioActual");

/** Stable key for one (year, scenario) annual dataset. */
const dsKey = (year: number, scenario: Scenario): string => `${year}|${scenario}`;

interface EnergyYearDialogProps {
  open: boolean;
  session: Session;
  onClose: () => void;
  /** Observation-page mode: the fixed building these observations are about. */
  building?: BuildingType;
  /** Create mode (from the Observations finder): owned buildings to pick from,
   *  so the building (the FeatureOfInterest) is chosen IN the dialog. Exactly one
   *  of `building` / `createFrom` is given; `createFrom` must be non-empty. */
  createFrom?: BuildingType[];
}

/**
 * Add, edit or remove the annual energy figures for a building. Each (year,
 * scenario) is its own `cons:EnergyDataset` resource — choosing the *actual*
 * readings or the *planned* (Soll) figures (#16) — so touching one doesn't affect
 * the others (#5). A table at the top lists the years already stored (the
 * read-back of what you entered); a row's Edit loads it back into the form, and
 * Delete removes that year. Saving keeps the dialog open so the table reflects
 * the change immediately. Opened either for a fixed `building` (the observation
 * page) or with `createFrom` (the finder's "Add observation"), where a required
 * building Select at the top names the FeatureOfInterest.
 */
export default function EnergyYearDialog(
  { open, session, onClose, building, createFrom }: EnergyYearDialogProps,
) {
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();
  const qc = useQueryClient();
  // Busy state, error toasts (central, classified) and the building-data
  // invalidations come from the hooks; the dialog owns the form + read-back UI.
  const write = useWriteEnergyYear();
  const del = useDeleteEnergyYear();
  const busy = write.isPending || del.isPending;

  // The building these observations are FOR (the FeatureOfInterest). Fixed in
  // observation-page mode; in create mode it's picked below — defaulting to the first
  // owned building, but **clearable**: an empty pick writes a building-less (unbound)
  // observation, to be linked to a building later.
  const [pickedUri, setPickedUri] = useState(
    (createFrom?.[0]?.uri as string | undefined) ?? "",
  );
  const selectedBuilding: BuildingType | null = building ??
    createFrom?.find((b) => (b.uri as string) === pickedUri) ?? null;

  const [year, setYear] = useState("");
  const [scenario, setScenario] = useState<Scenario>("actual");
  const [values, setValues] = useState<Record<string, string>>({});
  const [editingExisting, setEditingExisting] = useState(false);

  // Feature of interest: the whole building (default) or one of its energy units —
  // each a `bldg:hasSystem` node. Observations entered here attach to the chosen
  // unit (`sosa:hasFeatureOfInterest`), so a unit accrues its own per-year series,
  // mirroring MaStR's per-unit model. Only units that exist on the building are offered.
  const buildingFile = selectedBuilding
    ? buildingFileUri(selectedBuilding.uri as string)
    : "";
  const kindLabel = (kind: SystemKind) =>
    kind === "battery"
      ? msg("mdBatteryStorage")
      : kind === "chp"
      ? msg("mdChpSystem")
      : msg("mdPvSystem");
  // One option per energy unit (its actual node IRI), so an observation can attach to
  // exactly the unit the user picks — several of a kind disambiguated by the summary.
  const units = (selectedBuilding?.systems ?? []) as TechnicalSystem[];
  const foiOptions: Array<{ label: string; iri: string }> = [
    { label: msg("eyFoiBuilding"), iri: "" },
    ...units.map((s) => ({
      label: s.capacityKW != null || s.storageCapacityKWh != null
        ? `${kindLabel(s.kind)} (${s.capacityKW ?? s.storageCapacityKWh} ${
          s.kind === "battery" ? "kWh" : "kW"
        })`
        : kindLabel(s.kind),
      iri: `${buildingFile}#${s.id}`,
    })),
  ];
  const [foi, setFoi] = useState(""); // "" = the building as a whole
  const selectedFoi = foi || undefined;

  // The annual (P1Y) datasets stored for this building, with their figures — the
  // source of both the read-back table and the edit pre-fill. Loaded off the Pod
  // by the query hook (keyed on the dataset-link fingerprint, so a year that
  // landed via a buildings refetch shows up too); save/delete patch this cache
  // optimistically below so the table updates without waiting for a round-trip.
  const datasetsQuery = useAnnualDatasets(selectedBuilding, open);
  const datasets = useMemo(
    () => datasetsQuery.data ?? [],
    [datasetsQuery.data],
  );
  const listLoading = datasetsQuery.isLoading;

  // Patch the cached annual datasets in place (prefix-match across the
  // link-fingerprint key variants for this building) — the optimistic read-back.
  const patchDatasets = (fn: (prev: EnergyDataset[]) => EnergyDataset[]) =>
    qc.setQueriesData<EnergyDataset[]>(
      {
        queryKey: [
          ...queryKeys.annualDatasets,
          session.info.webId,
          selectedBuilding?.id ?? "",
        ],
      },
      (prev) => fn(prev ?? []),
    );

  const dirty = year.trim() !== "" ||
    Object.values(values).some((v) => v.trim() !== "");

  // The datasets for the currently-selected feature of interest (the building or a
  // unit) — the table, edit pre-fill and read-back are all scoped to it, so a unit's
  // series is entered/edited apart from the building's.
  const visible = useMemo(
    () => datasets.filter((d) => (d.featureOfInterest ?? "") === (selectedFoi ?? "")),
    [datasets, selectedFoi],
  );

  // (year, scenario) → stored dataset (within the selected FoI), for the edit pre-fill.
  const existingByKey = useMemo(
    () => new Map(visible.map((d) => [dsKey(d.year, d.scenario), d] as const)),
    [visible],
  );

  // The (year, scenario) currently reflected in the form from a load, so a
  // re-render doesn't clobber what the user has edited.
  const loadedKey = useRef<string | null>(null);

  // When the typed year+scenario matches a stored dataset, pre-fill its figures
  // (so editing one metric doesn't overwrite the untouched ones with nothing, #5).
  // The form fields are reset/pre-filled in reaction to live typing AND the async
  // dataset list arriving; the ref guards make it a no-op once settled. This is a
  // genuine input↔store reconciliation effect, not a render-derivable value.
  /* eslint-disable react-hooks/set-state-in-effect */
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
  /* eslint-enable react-hooks/set-state-in-effect */

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
      showNotification(msg("enterValidYear"), "error");
      return;
    }
    const metrics: AnnualMetrics = {};
    for (const { key, label } of metricFields()) {
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
      showNotification(msg("enterFigure"), "error");
      return;
    }
    // Building-less: write an UNBOUND observation (no building → no FoI). It surfaces
    // via the building-less observations list; there's no per-building cache to patch.
    if (!selectedBuilding) {
      write.mutate(
        { dataset: { building: "", year: y, granularity: "P1Y", scenario, metrics } },
        {
          onSuccess: () => {
            showNotification(msg("energySaved"), "success");
            const keep = scenario;
            reset();
            setScenario(keep);
          },
        },
      );
      return;
    }

    const subjectUri = selectedBuilding.uri as string;
    const dataset = {
      building: subjectUri,
      year: y,
      granularity: "P1Y",
      scenario,
      metrics,
      featureOfInterest: selectedFoi,
    };
    write.mutate(
      { fileUri: buildingFileUri(subjectUri), subjectUri, dataset },
      {
        onSuccess: () => {
          // Reflect the saved year in the table without a round-trip, then clear
          // the form so the user can see it land and add/edit another. Match on the
          // FoI too, so a unit's save never clobbers the building's same-year row.
          patchDatasets((prev) => {
            const rest = prev.filter(
              (d) =>
                !(d.year === y && d.scenario === scenario &&
                  (d.featureOfInterest ?? "") === (selectedFoi ?? "")),
            );
            return [...rest, dataset];
          });
          showNotification(msg("energySaved"), "success");
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
        title: msg("dlgDeleteEnergy"),
        message: msg("eyDeleteConfirm", {
          scenario: scenarioLabel(d.scenario),
          year: d.year,
        }),
        confirmLabel: msg("btnDelete"),
      })
    ) return;
    if (!selectedBuilding) return;
    const subjectUri = selectedBuilding.uri as string;
    del.mutate(
      {
        fileUri: buildingFileUri(subjectUri),
        subjectUri,
        dataset: {
          year: d.year,
          granularity: "P1Y",
          scenario: d.scenario,
          featureOfInterest: d.featureOfInterest,
        },
      },
      {
        onSuccess: () => {
          patchDatasets((prev) =>
            prev.filter(
              (x) =>
                !(x.year === d.year && x.scenario === d.scenario &&
                  (x.featureOfInterest ?? "") === (d.featureOfInterest ?? "")),
            )
          );
          // If the deleted year was loaded in the form, clear it.
          if (loadedKey.current === dsKey(d.year, d.scenario)) reset();
          showNotification(msg("energyYearDeleted"), "success");
        },
      },
    );
  };

  const sorted = [...visible].sort((a, b) =>
    a.year - b.year || a.scenario.localeCompare(b.scenario)
  );

  // Switching the feature of interest is like opening a different unit's sheet —
  // clear the in-progress form so a unit's figures don't leak onto another.
  const changeFoi = (next: string) => {
    setFoi(next);
    reset();
  };

  // Switching the building (create mode) is like opening a different sheet — clear
  // the in-progress form and reset the FoI to the new building's whole.
  const changeBuilding = (uri: string) => {
    setPickedUri(uri);
    setFoi("");
    reset();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={selectedBuilding
        ? <BuildingDialogTitle building={selectedBuilding} action={msg("eyAction")} />
        : msg("eyAction")}
      maxWidth="md"
      dirty={dirty}
      busy={busy}
      actions={
        <>
          <Button variant="text" onClick={close} disabled={busy}>{msg("btnClose")}</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={busy}
          >
            {busy ? msg("btnSaving") : msg("btnSave")}
          </Button>
        </>
      }
    >
      <Stack spacing={3} sx={{ mt: 1 }}>
        {/* Create mode: pick the building (the FeatureOfInterest) these observations
            are about — a searchable picker. Hidden in observation-page mode (the
            building is fixed). */}
        {createFrom && createFrom.length > 0 && (
          <BuildingPicker
            buildings={createFrom}
            label={msg("eyBuildingLabel")}
            value={pickedUri}
            onChange={changeBuilding}
            disabled={busy}
          />
        )}
        {/* Building-less (create mode, no building picked) — an unbound observation,
            to be linked to a building later. */}
        {createFrom && !selectedBuilding && (
          <Typography variant="body2" color="text.secondary">
            {msg("eyBuildinglessHint")}
          </Typography>
        )}
        {/* Feature of interest — the building or one of its energy units; only when a
            building with units is selected. */}
        {selectedBuilding && foiOptions.length > 1 && (
          <TextField
            select
            label={msg("eyObserveFor")}
            size="small"
            value={foi}
            onChange={(e) => changeFoi(e.target.value)}
            sx={{ alignSelf: "flex-start", minWidth: 240 }}
          >
            {foiOptions.map((o) => (
              <MenuItem key={o.iri} value={o.iri}>{o.label}</MenuItem>
            ))}
          </TextField>
        )}
        {/* Read-back of what's stored — only for a bound building (a building-less
            observation has no prior years to list). */}
        {selectedBuilding && (
          <section>
            <Typography variant="h6" sx={{ mb: 1 }}>{msg("eyStoredYears")}</Typography>
          {listLoading
            ? <Typography color="text.secondary">{msg("loadingEllipsis")}</Typography>
            : sorted.length === 0
            ? (
              <Typography color="text.secondary">
                {msg("eyNoneYet")}
              </Typography>
            )
            : (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>{msg("lblYear")}</strong></TableCell>
                      <TableCell><strong>{msg("lblScenario")}</strong></TableCell>
                      {metricFields().map((m) => (
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
                        {metricFields().map((m) => {
                          const v = d.metrics?.[m.key];
                          return (
                            <TableCell key={m.key} align="right">
                              {v != null ? fmt(v, m.decimals) : "—"}
                            </TableCell>
                          );
                        })}
                        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                          <Tooltip title={msg("eyEditYear")}>
                            <IconButton
                              size="small"
                              aria-label={msg("eyEditYear")}
                              onClick={() => editYear(d)}
                              disabled={busy}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={msg("eyDeleteYear")}>
                            <IconButton
                              size="small"
                              color="error"
                              aria-label={msg("eyDeleteYear")}
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
        )}

        {/* Add / edit one year. */}
        <section>
          <Typography variant="h6" sx={{ mb: 1 }}>
            {editingExisting ? msg("eyEditHeading") : msg("eyAddHeading")}
          </Typography>
          <Stack spacing={2}>
            <TextField
              label={msg("lblYear")}
              type="number"
              size="small"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
            <TextField
              select
              label={msg("lblScenario")}
              size="small"
              value={scenario}
              onChange={(e) => setScenario(e.target.value as Scenario)}
            >
              <MenuItem value="actual">{msg("scenarioActual")}</MenuItem>
              <MenuItem value="planned">{msg("scenarioPlanned")}</MenuItem>
            </TextField>
            {editingExisting && (
              <Typography variant="body2" color="text.secondary">
                {msg("eyEditingNote")}
              </Typography>
            )}
            {metricFields().map(({ key, label }) => (
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

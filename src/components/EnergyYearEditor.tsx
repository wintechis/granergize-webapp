import { msg } from "../lib/messages.ts";
import IconAction from "./IconAction.tsx";
import { useT } from "../context/I18nProvider.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
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
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { Session } from "@inrupt/solid-client-authn-browser";
import type {
  Building,
  Scenario,
  SystemKind,
  TechnicalSystem,
} from "../types.ts";
import { useQueryClient } from "@tanstack/react-query";
import {
  type AnnualMetrics,
  type EnergyDataset,
  type EnergyMetricKey,
} from "../services/energy/energyDataset.ts";
import { buildingFileUri } from "../services/rdf/building/buildingId.ts";
import BuildingPicker from "./BuildingPicker.tsx";
import {
  useDeleteEnergyYear,
  useWriteEnergyYear,
} from "../hooks/mutations.ts";
import { useAnnualDatasets } from "../hooks/queries.ts";
import { queryKeys } from "../lib/queryKeys.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { useConfirm } from "../context/ConfirmContext.tsx";
import Modal from "./Modal.tsx";
import { BuildingDialogTitle } from "./BuildingDialogTitle.tsx";
import { orderedAnnualMetrics, annualMetricLabel } from "../constants/annualMetrics.ts";

// Derived from the shared annual-metric schema (constants/annualMetrics.ts) so
// the entry form and the view dialogs can't drift on the metric set/labels.
// A function (not a const) so the labels resolve in the ACTIVE language on each
// render — the full label comes from the vocab, the short form from the catalog.
// Ordered by the building's DECLARED systems (relevant metrics first, the rest
// flagged for de-emphasis) — the master-data → consumption linkage; with no
// systems the canonical order applies and nothing is de-emphasised.
function metricFields(systems?: readonly TechnicalSystem[]): Array<
  {
    key: EnergyMetricKey;
    label: string;
    short: string;
    decimals: number;
    relevant: boolean;
  }
> {
  return orderedAnnualMetrics(systems).map((m) => ({
    key: m.key,
    label: annualMetricLabel(m.key),
    short: msg(m.shortId),
    decimals: m.decimals,
    relevant: m.relevant,
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

interface EnergyYearEditorProps {
  /** Modal mode only (the finder's create flow); ignored when `inline`. */
  open?: boolean;
  session: Session;
  onClose: () => void;
  /** Observation-page (inline) mode: the fixed building these observations are about. */
  building?: Building;
  /** Finder create mode: owned buildings you MAY optionally bind the new observation
   *  series to (a building, then optionally a subsystem of it). Binding is OPTIONAL —
   *  the picker defaults to UNBOUND, so a building-less series is the baseline, to be
   *  linked to a building later. */
  createFrom?: Building[];
  /** Render inline on the page (observation page) instead of in a Modal (the finder's
   *  create flow). Inline only mounts when shown, so its datasets query stays enabled. */
  inline?: boolean;
}

/**
 * Add, edit or remove the annual energy figures for a building. Each (year,
 * scenario) is its own `cons:EnergyDataset` resource — choosing the *actual*
 * readings or the *planned* (Soll) figures (#16) — so touching one doesn't affect
 * the others (#5). A table at the top lists the years already stored (the
 * read-back of what you entered); a row's Edit loads it back into the form, and
 * Delete removes that year. Saving keeps the dialog open so the table reflects
 * the change immediately. Opened either for a fixed `building` (the observation
 * page, inline) or with `createFrom` (the finder's "Add observation", a modal) — there
 * the building (and its subsystem) is OPTIONAL: the default is an UNBOUND series, with a
 * picker to bind it to a building / subsystem if you want, else it's linked to a building
 * later.
 */
export default function EnergyYearEditor(
  { open, session, onClose, building, createFrom, inline }: EnergyYearEditorProps,
) {
  const t = useT();
  const { showNotification } = useNotification();
  const { confirm } = useConfirm();
  const qc = useQueryClient();
  // Busy state, error toasts (central, classified) and the building-data
  // invalidations come from the hooks; the dialog owns the form + read-back UI.
  const write = useWriteEnergyYear();
  const del = useDeleteEnergyYear();
  const busy = write.isPending || del.isPending;

  // The building these observations are FOR (the FeatureOfInterest). Fixed in the
  // observation-page (inline) mode; in the finder's create mode it's OPTIONAL — the
  // picker defaults to UNBOUND ("") so a building-less series is the baseline, and
  // binding to a building (then a subsystem) is opt-in.
  const [pickedUri, setPickedUri] = useState("");
  const selectedBuilding: Building | null = building ??
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
      ? t("mdBatteryStorage")
      : kind === "chp"
      ? t("mdChpSystem")
      : t("mdPvSystem");
  // One option per energy unit (its actual node IRI), so an observation can attach to
  // exactly the unit the user picks — several of a kind disambiguated by the summary.
  const units = (selectedBuilding?.systems ?? []) as TechnicalSystem[];
  const foiOptions: Array<{ label: string; iri: string }> = [
    { label: t("eyFoiBuilding"), iri: "" },
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
  const datasetsQuery = useAnnualDatasets(selectedBuilding, inline || open);
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
      showNotification(t("enterValidYear"), "error");
      return;
    }
    const metrics: AnnualMetrics = {};
    for (const { key, label } of metricFields(selectedBuilding?.systems)) {
      const raw = values[key];
      if (raw && raw.trim() !== "") {
        const n = parseFloat(raw);
        // Reject, don't skip: silently dropping an unparseable figure (e.g. a
        // German "1,5" decimal comma — the read-back table itself formats
        // de-DE, inviting commas) would, when EDITING a stored year, silently
        // DELETE that metric from the PUT.
        if (isNaN(n)) {
          showNotification(
            t("energyValueNotANumber", { raw, label }),
            "error",
          );
          return;
        }
        metrics[key] = n;
      }
    }
    if (Object.keys(metrics).length === 0) {
      showNotification(t("enterFigure"), "error");
      return;
    }
    // A stored dataset exists for this (year, scenario) but its figures were
    // never loaded into the form — the user typed ahead of the async dataset
    // list, and the pre-fill effect deliberately kept their input. An empty
    // field then means "untouched", not "delete" (the user never saw the stored
    // value), so merge the stored metrics under the typed ones; otherwise the
    // PUT would silently drop every metric the user didn't re-enter.
    const storedUnloaded = existingByKey.get(dsKey(y, scenario));
    if (storedUnloaded && loadedKey.current !== dsKey(y, scenario)) {
      for (
        const [k, v] of Object.entries(storedUnloaded.metrics ?? {}) as [
          keyof AnnualMetrics,
          number,
        ][]
      ) {
        if (!(k in metrics)) metrics[k] = v;
      }
    }
    // Building-less: write an UNBOUND observation (no building → no FoI). It surfaces
    // via the building-less observations list; there's no per-building cache to patch.
    if (!selectedBuilding) {
      write.mutate(
        { dataset: { building: "", year: y, granularity: "P1Y", scenario, metrics } },
        {
          onSuccess: () => {
            showNotification(t("energySaved"), "success");
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
          showNotification(t("energySaved"), "success");
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
        title: t("dlgDeleteEnergy"),
        message: t("eyDeleteConfirm", {
          scenario: scenarioLabel(d.scenario),
          year: d.year,
        }),
        confirmLabel: t("btnDelete"),
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
          showNotification(t("energyYearDeleted"), "success");
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

  // Switching the bound building (create mode) is like opening a different sheet —
  // clear the in-progress form and reset the FoI to the new building's whole.
  const changeBuilding = (uri: string) => {
    setPickedUri(uri);
    setFoi("");
    reset();
  };

  const actions = (
    <>
      <Button variant="text" onClick={close} disabled={busy}>{t("btnClose")}</Button>
      <Button variant="contained" onClick={handleSave} disabled={busy}>
        {busy ? t("btnSaving") : t("btnSave")}
      </Button>
    </>
  );
  const titleNode = selectedBuilding
    ? <BuildingDialogTitle building={selectedBuilding} action={t("eyAction")} />
    : t("eyAction");
  const content = (
      <Stack spacing={3} sx={{ mt: 1 }}>
        {/* Finder create mode: OPTIONALLY bind the new series to a building (then a
            subsystem, via the FoI selector below). The picker defaults to unbound; leave
            it empty for a building-less series, linked to a building later. Shown only
            when you own buildings to bind to; hidden in the observation-page mode. */}
        {createFrom && createFrom.length > 0 && (
          <BuildingPicker
            buildings={createFrom}
            label={t("eyBuildingLabel")}
            value={pickedUri}
            onChange={changeBuilding}
            disabled={busy}
          />
        )}
        {/* Unbound (create mode, no building bound) — a building-less observation, to be
            linked to a building later. */}
        {createFrom && !selectedBuilding && (
          <Typography variant="body2" color="text.secondary">
            {t("eyBuildinglessHint")}
          </Typography>
        )}
        {/* Feature of interest — the building or one of its energy units; only when a
            building with units is selected. */}
        {selectedBuilding && foiOptions.length > 1 && (
          <TextField
            select
            label={t("eyObserveFor")}
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
            <Typography variant="h6" sx={{ mb: 1 }}>{t("eyStoredYears")}</Typography>
          {listLoading
            ? <Typography color="text.secondary">{t("loadingEllipsis")}</Typography>
            : sorted.length === 0
            ? (
              <Typography color="text.secondary">
                {t("eyNoneYet")}
              </Typography>
            )
            : (
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell><strong>{t("lblYear")}</strong></TableCell>
                      <TableCell><strong>{t("lblScenario")}</strong></TableCell>
                      {metricFields(selectedBuilding?.systems).map((m) => (
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
                        {metricFields(selectedBuilding?.systems).map((m) => {
                          const v = d.metrics?.[m.key];
                          return (
                            <TableCell key={m.key} align="right">
                              {v != null ? fmt(v, m.decimals) : "—"}
                            </TableCell>
                          );
                        })}
                        <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                          <IconAction
  label={t("eyEditYear")}
  icon={<EditIcon fontSize="small" />}
  disabled={busy}
  onClick={() => editYear(d)}
/>
                          <IconAction
  label={t("eyDeleteYear")}
  icon={<DeleteIcon fontSize="small" />}
  color="error"
  disabled={busy}
  onClick={() => handleDelete(d)}
/>
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
            {editingExisting ? t("eyEditHeading") : t("eyAddHeading")}
          </Typography>
          <Stack spacing={2}>
            <TextField
              label={t("lblYear")}
              type="number"
              size="small"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
            <TextField
              select
              label={t("lblScenario")}
              size="small"
              value={scenario}
              onChange={(e) => setScenario(e.target.value as Scenario)}
            >
              <MenuItem value="actual">{t("scenarioActual")}</MenuItem>
              <MenuItem value="planned">{t("scenarioPlanned")}</MenuItem>
            </TextField>
            {editingExisting && (
              <Typography variant="body2" color="text.secondary">
                {t("eyEditingNote")}
              </Typography>
            )}
            {metricFields(selectedBuilding?.systems).map(({ key, label, relevant }) => (
              <TextField
                key={key}
                label={label}
                type="number"
                size="small"
                value={values[key] ?? ""}
                onChange={(e) =>
                  setValues((v) => ({ ...v, [key]: e.target.value }))}
                // De-emphasise (never hide) the metrics the building's declared
                // systems don't suggest — the unified schema stays intact.
                slotProps={relevant ? undefined : {
                  inputLabel: { sx: { color: "text.secondary" } },
                }}
              />
            ))}
          </Stack>
        </section>
      </Stack>
  );

  // Observation page: render inline on the page (the editor only mounts while editing).
  if (inline) {
    return (
      <Box>
        {content}
        <Stack
          direction="row"
          spacing={1}
          sx={{ justifyContent: "flex-end", mt: 2 }}
        >
          {actions}
        </Stack>
      </Box>
    );
  }
  // Finder create flow: the same editor in a Modal (a building picker at the top).
  return (
    <Modal
      open={open ?? false}
      onClose={close}
      title={titleNode}
      maxWidth="md"
      dirty={dirty}
      busy={busy}
      actions={actions}
    >
      {content}
    </Modal>
  );
}

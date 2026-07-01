import type { MessageId } from "../lib/messages.ts";
import { useT } from "../context/I18nProvider.tsx";
import { buildingFileUri } from "../services/rdf/building/buildingId.ts";
import BuildingPicker from "./BuildingPicker.tsx";
import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Radio,
  RadioGroup,
  Select,
  SelectChangeEvent,
  TextField,
  Typography,
} from "@mui/material";
import type {
  AggregationKind,
  Building,
} from "../types.ts";
import type { RegionLevel } from "../services/aggregation/regionRollup.ts";
import { isSeriesGranularity } from "../services/rdf/durationUtils.ts";
import { monthsFromDays, selectedSeriesRefs } from "./createAggregationMonths.ts";
import { useSeriesDays, useSharedWithMe } from "../hooks/queries.ts";
import { useCreateAggregation } from "../hooks/mutations.ts";
import {
  type Contributors,
  summarizeContributors,
} from "../services/aggregation/aggregationComputer.ts";
import {
  ANNUAL_METRICS as ANNUAL_METRIC_SCHEMA,
  annualMetricLabel,
  CONSUMPTION_METRIC_KEYS,
} from "../constants/annualMetrics.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import Modal from "./Modal.tsx";

interface CreateAggregationDialogProps {
  open: boolean;
  buildings: Building[];
  onClose: () => void;
}

/**
 * An aggregation's *mode* — derived from the data shape, not a role: an annual portfolio
 * over owned buildings, a monthly aggregation over buildings with a 15-minute series, or a
 * benchmark over the buildings shared *to* this user. Replaces the old per-role
 * partition (roles live only in data rooms now).
 */
type AggregationMode = "annual" | "monthly" | "benchmark";

const MODE_LABEL: Record<AggregationMode, MessageId> = {
  annual: "aggModeAnnual",
  monthly: "aggModeMonthly",
  benchmark: "aggModeBenchmark",
};

const MODE_DESCRIPTION: Record<AggregationMode, MessageId> = {
  annual: "aggDescAnnual",
  monthly: "aggDescMonthly",
  benchmark: "aggDescBenchmark",
};

// Annual metrics any building may carry (read from building.annualData); a
// sparse set the user ticks. Grouped for the checklist but DERIVED from the
// shared annual-metric schema (constants/annualMetrics.ts) — the same table the
// entry form renders, so the checklist can never offer a metric no form
// captures (heike-4's confusion). Offered for the annual portfolio and (minus
// the ratio metric) the benchmark.
const ANNUAL_METRIC_GROUPS: { category: MessageId; metrics: string[] }[] = [
  { category: "aggGroupConsumption", metrics: CONSUMPTION_METRIC_KEYS as string[] },
  {
    category: "aggGroupGeneration",
    metrics: ANNUAL_METRIC_SCHEMA.filter((m) => m.unit === "%").map((m) => m.key as string),
  },
];

const DEFAULT_ANNUAL_METRICS = [
  "electricityConsumption",
  "heatConsumption",
  "waterConsumption",
];
const BENCHMARK_METRICS = CONSUMPTION_METRIC_KEYS as string[];

function metricsForMode(
  mode: AggregationMode,
): { category: MessageId; metrics: string[] }[] {
  return mode === "benchmark"
    ? [{ category: "aggGroupConsumption", metrics: BENCHMARK_METRICS }]
    : ANNUAL_METRIC_GROUPS;
}

export default function CreateAggregationDialog({
  open,
  buildings,
  onClose,
}: CreateAggregationDialogProps) {
  const t = useT();
  const { showNotification } = useNotification();

  // The buildings shared *to* this user (the benchmark aggregates these),
  // kept separate from the user's own buildings that the annual/monthly modes
  // aggregate. Derived in memory from the shared-in fold (never fold a log in
  // a component); the share/revoke/drain invalidations keep it fresh, and a
  // user with no received buildings simply has no benchmark mode.
  const sharedWithMe = useSharedWithMe();
  const sharedContributors = useMemo<Contributors>(
    () => summarizeContributors(sharedWithMe.data ?? []),
    [sharedWithMe.data],
  );

  // URIs (fragment-stripped) of buildings shared to this user, for membership tests.
  const sharedUriSet = useMemo(
    () => new Set(sharedContributors.buildingUris.map(buildingFileUri)),
    [sharedContributors],
  );

  // Buildings the user owns (everything not shared *to* them as a benchmark roster).
  const ownedBuildings = useMemo(
    () => buildings.filter((b) => b.uri && !sharedUriSet.has(buildingFileUri(b.uri))),
    [buildings, sharedUriSet],
  );

  // The modes the data supports — by shape, not role: an annual portfolio always; a
  // monthly aggregation when some owned building carries a 15-minute series; a benchmark
  // when buildings have been shared to this user.
  const availableModes = useMemo<AggregationMode[]>(() => {
    const modes: AggregationMode[] = ["annual"];
    const hasSeries = ownedBuildings.some((b) =>
      (b.energyDatasets ?? []).some((r) => isSeriesGranularity(r.granularity))
    );
    if (hasSeries) modes.push("monthly");
    if (sharedUriSet.size > 0) modes.push("benchmark");
    return modes;
  }, [ownedBuildings, sharedUriSet]);

  const [mode, setMode] = useState<AggregationMode>("annual");
  // Busy state, error toast (central, classified) and the aggregation-definitions
  // invalidation come from the hook.
  const create = useCreateAggregation();
  const creating = create.isPending;
  const [aggregationName, setAggregationName] = useState("");
  const [selectedBuildings, setSelectedBuildings] = useState<string[]>([]);
  // The region grain to record as the aggregation's spatial extent (Slice 6). "auto" → inferred
  // at the finest shared region; a chosen level coarsens to that grain (or records none if the
  // buildings don't share it).
  const [extentLevel, setExtentLevel] = useState<RegionLevel | "auto">("auto");
  const [aggregationType, setAggregationType] = useState<AggregationKind>(
    "average",
  );
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(
    DEFAULT_ANNUAL_METRICS,
  );
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");

  const availableMetrics = metricsForMode(mode);

  const handleModeChange = (event: SelectChangeEvent<AggregationMode>) => {
    const next = event.target.value as AggregationMode;
    setMode(next);
    setSelectedBuildings([]);
    setSelectedMetrics(next === "benchmark" ? BENCHMARK_METRICS : DEFAULT_ANNUAL_METRICS);
    setSelectedPeriod("");
  };

  const handleClose = () => {
    setAggregationName("");
    setSelectedBuildings([]);
    setAggregationType("average");
    // Reset the mode + extent too: the finder mounts this dialog
    // unconditionally, so any state not reset here leaks into the next open.
    setMode("annual");
    setExtentLevel("auto");
    setSelectedMetrics(DEFAULT_ANNUAL_METRICS);
    setSelectedPeriod("");
    onClose();
  };

  const handleMetricToggle = (metric: string) => {
    setSelectedMetrics((prev) =>
      prev.includes(metric)
        ? prev.filter((m) => m !== metric)
        : [...prev, metric]
    );
  };

  // Candidate buildings by mode: benchmark → the buildings shared *to* this user;
  // monthly → owned buildings carrying a 15-minute series; annual → all owned.
  // Memoized so the month-discovery effect below can honestly depend on it.
  const availableBuildings = useMemo(
    () =>
      mode === "benchmark"
        ? buildings.filter((b) => b.uri && sharedUriSet.has(buildingFileUri(b.uri)))
        : mode === "monthly"
        ? ownedBuildings.filter((b) =>
          (b.energyDatasets ?? []).some((r) => isSeriesGranularity(r.granularity))
        )
        : ownedBuildings,
    [mode, buildings, sharedUriSet, ownedBuildings],
  );

  // Available months for monthly aggregations: the day files behind the SELECTED
  // buildings' 15-min series (read through the data layer; the files are
  // separate resources, not inline on the building), reduced to their months.
  // Scoped to the selection so every offered month has data in the aggregation
  // (heike-5 #4). The hook disables itself with nothing selected (no refs →
  // no query).
  const seriesRefs = useMemo(
    () =>
      mode === "monthly"
        ? selectedSeriesRefs(availableBuildings, selectedBuildings)
        : [],
    [mode, availableBuildings, selectedBuildings],
  );
  const seriesDays = useSeriesDays(seriesRefs);
  // A disabled query (no selection yet) stays "pending" forever — only count a
  // real in-flight load. A selection change serves the PREVIOUS selection's
  // days as placeholder data (the global keepPreviousData), whose months must
  // not be offered — that would reintroduce the pick-a-dataless-month bug.
  const monthsLoading = seriesRefs.length > 0 &&
    (seriesDays.isPending || seriesDays.isPlaceholderData);
  const availableMonths = useMemo(
    () =>
      seriesDays.isPlaceholderData
        ? []
        : monthsFromDays(seriesDays.data ?? []),
    [seriesDays.data, seriesDays.isPlaceholderData],
  );
  // The selection can change under a picked month; only a month the current
  // selection actually carries counts (the Select's value guard shows the same).
  const effectivePeriod = availableMonths.includes(selectedPeriod)
    ? selectedPeriod
    : "";

  const handleCreate = () => {
    if (!aggregationName.trim()) {
      showNotification(t("enterAggregationName"), "warning");
      return;
    }
    if (selectedBuildings.length === 0) {
      showNotification(t("selectBuilding"), "warning");
      return;
    }
    if (mode === "monthly" && !effectivePeriod) {
      showNotification(t("selectMonth"), "warning");
      return;
    }
    if (mode !== "monthly" && selectedMetrics.length === 0) {
      showNotification(t("selectMetric"), "warning");
      return;
    }

    // A benchmark aggregation records the flag ON the definition, so every later
    // recompute (incl. plain refresh) re-derives the bench:BenchmarkResult
    // typing + covered year from it — nothing to remember at call sites.
    create.mutate(
      {
        name: aggregationName.trim(),
        buildingUris: selectedBuildings,
        aggregationType,
        metrics: mode === "monthly" ? ["electricity"] : selectedMetrics,
        period: mode === "monthly" ? effectivePeriod : undefined,
        benchmark: mode === "benchmark",
        extentLevel: extentLevel === "auto" ? undefined : extentLevel,
      },
      {
        onSuccess: () => {
          showNotification(t("aggregationCreated"), "success");
          handleClose();
        },
      },
    );
  };

  // Only worth showing when the data supports more than one mode; otherwise the
  // single annual portfolio is implicit.
  const modeDropdown = availableModes.length > 1 && (
    <FormControl fullWidth size="small" sx={{ mb: 3 }}>
      <InputLabel id="mode-label">{t("aggTypeLabel")}</InputLabel>
      <Select<AggregationMode>
        labelId="mode-label"
        value={mode}
        onChange={handleModeChange}
        input={<OutlinedInput label={t("aggTypeLabel")} />}
      >
        {availableModes.map((m) => (
          <MenuItem key={m} value={m}>
            {t(MODE_LABEL[m])}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  const buildingSelect = (
    <Box sx={{ mb: 3 }}>
      <BuildingPicker
        multiple
        buildings={availableBuildings}
        label={t("aggSelectBuildings")}
        value={selectedBuildings}
        onChange={setSelectedBuildings}
      />
    </Box>
  );

  // The region grain the aggregation reports at — a first-class choice (Slice 6) rather than
  // only the inferred finest. Resolved from the selected buildings at create.
  const extentSelect = (
    <FormControl fullWidth size="small" sx={{ mb: 3 }}>
      <InputLabel id="extent-level-label">{t("aggExtentLabel")}</InputLabel>
      <Select
        labelId="extent-level-label"
        label={t("aggExtentLabel")}
        value={extentLevel}
        onChange={(e) => setExtentLevel(e.target.value as RegionLevel | "auto")}
      >
        <MenuItem value="auto">{t("aggExtentAuto")}</MenuItem>
        <MenuItem value="gemeinde">{t("aggExtentGemeinde")}</MenuItem>
        <MenuItem value="kreis">{t("aggExtentKreis")}</MenuItem>
        <MenuItem value="land">{t("aggExtentLand")}</MenuItem>
        <MenuItem value="bund">{t("aggExtentBund")}</MenuItem>
      </Select>
      <FormHelperText>{t("aggExtentHelp")}</FormHelperText>
    </FormControl>
  );

  // One render, used by both branches (was duplicated inline in the monthly
  // branch); `mb` is the only thing that differed between the two copies.
  const aggregationRadio = (mb: number) => (
    <FormControl component="fieldset" sx={{ mb }}>
      <FormLabel component="legend">{t("aggFnLegend")}</FormLabel>
      <RadioGroup
        row
        value={aggregationType}
        onChange={(e) => setAggregationType(e.target.value as AggregationKind)}
      >
        <FormControlLabel value="average" control={<Radio />} label={t("aggFnAverage")} />
        <FormControlLabel value="sum" control={<Radio />} label={t("aggFnSum")} />
        <FormControlLabel value="min" control={<Radio />} label={t("aggFnMin")} />
        <FormControlLabel value="max" control={<Radio />} label={t("aggFnMax")} />
      </RadioGroup>
    </FormControl>
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dirty={aggregationName.trim() !== "" || selectedBuildings.length > 0}
      busy={creating}
      title={t("aggCreateTitle")}
      actions={!creating && (
        <>
          <Button onClick={handleClose}>{t("btnCancel")}</Button>
          <Button
            onClick={handleCreate}
            variant="contained"
            disabled={!aggregationName.trim() || selectedBuildings.length === 0 ||
              (mode === "monthly"
                ? !effectivePeriod
                : selectedMetrics.length === 0)}
          >
            {t("aggCreateTitle")}
          </Button>
        </>
      )}
    >
      {creating
        ? (
          <Typography sx={{ my: 2 }}>
            {t("aggCreatingSnapshot")}
          </Typography>
        )
        : mode === "monthly"
        ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t(MODE_DESCRIPTION.monthly)}
            </Typography>

            {modeDropdown}

              <TextField
                autoFocus
                margin="dense"
                id="aggregationName"
                label={t("aggNameLabel")}
                type="text"
                fullWidth
                size="small"
                variant="outlined"
                value={aggregationName}
                onChange={(e) => setAggregationName(e.target.value)}
                placeholder={t("aggNamePlaceholderMonthly")}
                sx={{ mb: 3 }}
              />

              {buildingSelect}

              {/* A Select over the months the SELECTED buildings actually carry
                  data for — a free month input let the user pick an in-range but
                  data-less month (months are sparse, not contiguous), whose
                  compute yielded an empty snapshot (heike-4's empty diagram;
                  heike-5 #4 was the same hole via unselected buildings' months).
                  Disabled until the months are knowable; the discovery is a real
                  Pod listing, so it says so instead of sitting empty (heike-5 #2). */}
              <FormControl
                fullWidth
                size="small"
                sx={{ mb: 3 }}
                disabled={selectedBuildings.length === 0 || monthsLoading}
              >
                <InputLabel id="aggregation-month-label">{t("aggMonthLabel")}</InputLabel>
                <Select
                  labelId="aggregation-month-label"
                  label={t("aggMonthLabel")}
                  value={effectivePeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                >
                  {availableMonths.map((m) => (
                    <MenuItem key={m} value={m}>{m}</MenuItem>
                  ))}
                </Select>
                {(selectedBuildings.length === 0 || monthsLoading) && (
                  <FormHelperText>
                    {selectedBuildings.length === 0
                      ? t("aggSelectBuildingsFirst")
                      : t("loadingEllipsis")}
                  </FormHelperText>
                )}
              </FormControl>
              {selectedBuildings.length > 0 && !monthsLoading &&
                seriesDays.isSuccess && availableMonths.length === 0 && (
                <Alert severity="info" sx={{ mb: 3 }}>
                  {t("aggNoSeriesData")}
                </Alert>
              )}

              {aggregationRadio(1)}

              {extentSelect}
          </>
        )
        : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t(MODE_DESCRIPTION[mode])}
            </Typography>

            {modeDropdown}

              <TextField
                autoFocus
                margin="dense"
                id="aggregationName"
                label={t("aggNameLabel")}
                type="text"
                fullWidth
                size="small"
                variant="outlined"
                value={aggregationName}
                onChange={(e) => setAggregationName(e.target.value)}
                placeholder={t("aggNamePlaceholderAnnual")}
                sx={{ mb: 3 }}
              />

              {buildingSelect}

              {extentSelect}

              {aggregationRadio(3)}

              <FormControl component="fieldset">
                <FormLabel component="legend">{t("aggMetricsLegend")}</FormLabel>
                <Box sx={{ mt: 1 }}>
                  {availableMetrics.map((category) => {
                    const allSelected = category.metrics.every((m) =>
                      selectedMetrics.includes(m)
                    );
                    return (
                      <Box key={category.category} sx={{ mb: 2 }}>
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          <Typography variant="h6" color="textSecondary">
                            {t(category.category)}
                          </Typography>
                          {mode === "benchmark" && (
                            <Button
                              size="small"
                              onClick={() =>
                                setSelectedMetrics((prev) =>
                                  allSelected
                                    ? prev.filter((m) =>
                                      !category.metrics.includes(m)
                                    )
                                    : [
                                      ...new Set([
                                        ...prev,
                                        ...category.metrics,
                                      ]),
                                    ]
                                )}
                            >
                              {allSelected ? t("aggDeselectAll") : t("aggSelectAll")}
                            </Button>
                          )}
                        </Box>
                        <FormGroup row>
                          {category.metrics.map((metric) => (
                            <FormControlLabel
                              key={metric}
                              control={
                                <Checkbox
                                  checked={selectedMetrics.includes(metric)}
                                  onChange={() => handleMetricToggle(metric)}
                                  size="small"
                                />
                              }
                              label={annualMetricLabel(metric)}
                            />
                          ))}
                        </FormGroup>
                      </Box>
                    );
                  })}
                </Box>
              </FormControl>
          </>
        )}
    </Modal>
  );
}

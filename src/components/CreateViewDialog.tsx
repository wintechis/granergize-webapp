import { buildingDisplayName } from "../lib/buildingDisplay.ts";
import { buildingFileUri } from "../services/rdf/building/buildingId.ts";
import { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  InputLabel,
  ListItemText,
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
  AggregationType,
  BuildingType,
} from "../types.ts";
import { isSeriesGranularity } from "../services/rdf/durationUtils.ts";
import { monthsFromDays, selectedSeriesRefs } from "./createViewMonths.ts";
import { useSeriesDays, useSharedWithMe } from "../hooks/queries.ts";
import { useCreateView } from "../hooks/mutations.ts";
import {
  type Contributors,
  summarizeContributors,
} from "../services/aggregation/viewComputer.ts";
import {
  ANNUAL_METRICS as ANNUAL_METRIC_SCHEMA,
  annualMetricLabel,
  CONSUMPTION_METRIC_KEYS,
} from "../constants/annualMetrics.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import Modal from "./Modal.tsx";

interface CreateViewDialogProps {
  open: boolean;
  buildings: BuildingType[];
  onClose: () => void;
}

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;
const MenuProps = {
  PaperProps: {
    style: {
      maxHeight: ITEM_HEIGHT * 4.5 + ITEM_PADDING_TOP,
      width: 250,
    },
  },
};

/**
 * A view's *mode* — derived from the data shape, not a role: an annual portfolio
 * over owned buildings, a monthly view over buildings with a 15-minute series, or a
 * benchmark over the buildings shared *to* this user. Replaces the old per-role
 * partition (roles live only in data rooms now).
 */
type ViewMode = "annual" | "monthly" | "benchmark";

const MODE_LABEL: Record<ViewMode, string> = {
  annual: "Annual portfolio",
  monthly: "Monthly (15-minute series)",
  benchmark: "Compare shared buildings",
};

const MODE_DESCRIPTION: Record<ViewMode, string> = {
  annual:
    "Aggregate annual energy figures across your buildings. The computed values are " +
    "stored as a privacy-preserving snapshot that can be shared without revealing the " +
    "source buildings.",
  monthly:
    "Aggregate monthly electricity consumption across buildings that carry a 15-minute " +
    "load profile. The result is a privacy-preserving snapshot of the combined kWh total.",
  benchmark:
    "Aggregate annual consumption across the buildings shared with you. " +
    "Metrics: electricity, heat, water, and wastewater consumption (kWh / m³).",
};

// Annual metrics any building may carry (read from building.annualData); a
// sparse set the user ticks. Grouped for the checklist but DERIVED from the
// shared annual-metric schema (constants/annualMetrics.ts) — the same table the
// entry form renders, so the checklist can never offer a metric no form
// captures (heike-4's confusion). Offered for the annual portfolio and (minus
// the ratio metric) the benchmark.
const ANNUAL_METRIC_GROUPS = [
  { category: "Annual Consumption", metrics: CONSUMPTION_METRIC_KEYS as string[] },
  {
    category: "Renewable Generation",
    metrics: ANNUAL_METRIC_SCHEMA.filter((m) => m.unit === "%").map((m) => m.key as string),
  },
];

const DEFAULT_ANNUAL_METRICS = [
  "electricityConsumption",
  "heatConsumption",
  "waterConsumption",
];
const BENCHMARK_METRICS = CONSUMPTION_METRIC_KEYS as string[];

function metricsForMode(mode: ViewMode) {
  return mode === "benchmark"
    ? [{ category: "Annual Consumption", metrics: BENCHMARK_METRICS }]
    : ANNUAL_METRIC_GROUPS;
}

export default function CreateViewDialog({
  open,
  buildings,
  onClose,
}: CreateViewDialogProps) {
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
  // monthly view when some owned building carries a 15-minute series; a benchmark
  // when buildings have been shared to this user.
  const availableModes = useMemo<ViewMode[]>(() => {
    const modes: ViewMode[] = ["annual"];
    const hasSeries = ownedBuildings.some((b) =>
      (b.energyDatasets ?? []).some((r) => isSeriesGranularity(r.granularity))
    );
    if (hasSeries) modes.push("monthly");
    if (sharedUriSet.size > 0) modes.push("benchmark");
    return modes;
  }, [ownedBuildings, sharedUriSet]);

  const [mode, setMode] = useState<ViewMode>("annual");
  // Busy state, error toast (central, classified) and the view-definitions
  // invalidation come from the hook.
  const create = useCreateView();
  const creating = create.isPending;
  const [viewName, setViewName] = useState("");
  const [selectedBuildings, setSelectedBuildings] = useState<string[]>([]);
  const [aggregationType, setAggregationType] = useState<AggregationType>(
    "average",
  );
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(
    DEFAULT_ANNUAL_METRICS,
  );
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");

  const availableMetrics = metricsForMode(mode);

  const handleModeChange = (event: SelectChangeEvent<ViewMode>) => {
    const next = event.target.value as ViewMode;
    setMode(next);
    setSelectedBuildings([]);
    setSelectedMetrics(next === "benchmark" ? BENCHMARK_METRICS : DEFAULT_ANNUAL_METRICS);
    setSelectedPeriod("");
  };

  const handleClose = () => {
    setViewName("");
    setSelectedBuildings([]);
    setAggregationType("average");
    setSelectedMetrics(mode === "benchmark" ? BENCHMARK_METRICS : DEFAULT_ANNUAL_METRICS);
    setSelectedPeriod("");
    onClose();
  };

  const handleBuildingChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value;
    setSelectedBuildings(typeof value === "string" ? value.split(",") : value);
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

  // Available months for monthly views: the day files behind the SELECTED
  // buildings' 15-min series (read through the data layer; the files are
  // separate resources, not inline on the building), reduced to their months.
  // Scoped to the selection so every offered month has data in the view
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
    if (!viewName.trim()) {
      showNotification("Please enter a view name", "warning");
      return;
    }
    if (selectedBuildings.length === 0) {
      showNotification("Please select at least one building", "warning");
      return;
    }
    if (mode === "monthly" && !effectivePeriod) {
      showNotification("Please select a month", "warning");
      return;
    }
    if (mode !== "monthly" && selectedMetrics.length === 0) {
      showNotification("Please select at least one metric", "warning");
      return;
    }

    // A benchmark view records the flag ON the definition, so every later
    // recompute (incl. plain refresh) re-derives the bench:BenchmarkResult
    // typing + covered year from it — nothing to remember at call sites.
    create.mutate(
      {
        name: viewName.trim(),
        buildingUris: selectedBuildings,
        aggregationType,
        metrics: mode === "monthly" ? ["electricity"] : selectedMetrics,
        period: mode === "monthly" ? effectivePeriod : undefined,
        benchmark: mode === "benchmark",
      },
      {
        onSuccess: () => {
          showNotification("View created successfully", "success");
          handleClose();
        },
      },
    );
  };

  // Only worth showing when the data supports more than one mode; otherwise the
  // single annual portfolio is implicit.
  const modeDropdown = availableModes.length > 1 && (
    <FormControl fullWidth sx={{ mb: 3 }}>
      <InputLabel id="mode-label">View type</InputLabel>
      <Select<ViewMode>
        labelId="mode-label"
        value={mode}
        onChange={handleModeChange}
        input={<OutlinedInput label="View type" />}
      >
        {availableModes.map((m) => (
          <MenuItem key={m} value={m}>
            {MODE_LABEL[m]}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  const buildingSelect = (
    <FormControl fullWidth sx={{ mb: 3 }}>
      <InputLabel id="buildings-label">Select Buildings</InputLabel>
      <Select
        labelId="buildings-label"
        id="buildings-select"
        multiple
        value={selectedBuildings}
        onChange={handleBuildingChange}
        input={<OutlinedInput label="Select Buildings" />}
        renderValue={(selected) => (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {selected.map((uri) => {
              const building = availableBuildings.find((b) =>
                b.uri === uri
              );
              return (
                <Chip
                  key={uri}
                  label={building ? buildingDisplayName(building) : uri}
                  size="small"
                />
              );
            })}
          </Box>
        )}
        MenuProps={MenuProps}
      >
        {availableBuildings.map((building) => (
          <MenuItem key={building.uri} value={building.uri}>
            <Checkbox checked={selectedBuildings.includes(building.uri)} />
            <ListItemText
              primary={buildingDisplayName(building)}
              secondary={building.streetAddress !== buildingDisplayName(building)
                ? building.streetAddress || building.locality || ""
                : building.locality || ""}
            />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  const aggregationRadio = (
    <FormControl component="fieldset" sx={{ mb: 3 }}>
      <FormLabel component="legend">Aggregation Type</FormLabel>
      <RadioGroup
        row
        value={aggregationType}
        onChange={(e) => setAggregationType(e.target.value as AggregationType)}
      >
        <FormControlLabel value="average" control={<Radio />} label="Average" />
        <FormControlLabel value="sum" control={<Radio />} label="Sum" />
        <FormControlLabel value="min" control={<Radio />} label="Minimum" />
        <FormControlLabel value="max" control={<Radio />} label="Maximum" />
      </RadioGroup>
    </FormControl>
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dirty={viewName.trim() !== "" || selectedBuildings.length > 0}
      busy={creating}
      title="Create Aggregated View"
      actions={!creating && (
        <>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleCreate}
            variant="contained"
            disabled={!viewName.trim() || selectedBuildings.length === 0 ||
              (mode === "monthly"
                ? !effectivePeriod
                : selectedMetrics.length === 0)}
          >
            Create View
          </Button>
        </>
      )}
    >
      {creating
        ? (
          <Typography sx={{ my: 2 }}>
            Creating view and computing snapshot…
          </Typography>
        )
        : mode === "monthly"
        ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {MODE_DESCRIPTION.monthly}
            </Typography>

            {modeDropdown}

              <TextField
                autoFocus
                margin="dense"
                id="viewName"
                label="View Name"
                type="text"
                fullWidth
                variant="outlined"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="e.g., Warehouse Portfolio March 2024"
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
                size="small"
                sx={{ mb: 3, minWidth: 160 }}
                disabled={selectedBuildings.length === 0 || monthsLoading}
              >
                <InputLabel id="view-month-label">Month</InputLabel>
                <Select
                  labelId="view-month-label"
                  label="Month"
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
                      ? "Select buildings first"
                      : "Loading…"}
                  </FormHelperText>
                )}
              </FormControl>
              {selectedBuildings.length > 0 && !monthsLoading &&
                seriesDays.isSuccess && availableMonths.length === 0 && (
                <Alert severity="info" sx={{ mb: 3 }}>
                  The selected buildings carry no 15-minute series data for any
                  month.
                </Alert>
              )}

              <FormControl component="fieldset" sx={{ mb: 1 }}>
                <FormLabel component="legend">Aggregation Type</FormLabel>
                <RadioGroup
                  row
                  value={aggregationType}
                  onChange={(e) =>
                    setAggregationType(e.target.value as AggregationType)}
                >
                  <FormControlLabel
                    value="average"
                    control={<Radio />}
                    label="Average"
                  />
                  <FormControlLabel
                    value="sum"
                    control={<Radio />}
                    label="Sum"
                  />
                  <FormControlLabel
                    value="min"
                    control={<Radio />}
                    label="Minimum"
                  />
                  <FormControlLabel
                    value="max"
                    control={<Radio />}
                    label="Maximum"
                  />
                </RadioGroup>
              </FormControl>
          </>
        )
        : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {MODE_DESCRIPTION[mode]}
            </Typography>

            {modeDropdown}

              <TextField
                autoFocus
                margin="dense"
                id="viewName"
                label="View Name"
                type="text"
                fullWidth
                variant="outlined"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder="e.g., Portfolio Average 2024"
                sx={{ mb: 3 }}
              />

              {buildingSelect}

              {aggregationRadio}

              <FormControl component="fieldset">
                <FormLabel component="legend">Metrics to Include</FormLabel>
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
                            {category.category}
                          </Typography>
                          {mode === "benchmark" && (
                            <Typography
                              variant="caption"
                              color="primary"
                              sx={{ cursor: "pointer", userSelect: "none" }}
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
                              {allSelected ? "Deselect all" : "Select all"}
                            </Typography>
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

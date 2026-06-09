import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControl,
  FormControlLabel,
  FormGroup,
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
import { Session } from "@inrupt/solid-client-authn-browser";
import type {
  AggregationType,
  BuildingType,
} from "../types.ts";
import { createViewDefinition } from "../services/aggregation/viewManager.ts";
import { isSeriesGranularity } from "../services/rdf/durationUtils.ts";
import { listDirectChildren } from "../services/pod/podDelete.ts";
import {
  type BspContributors,
  bspContributorBuildings,
  computeAndStoreSnapshot,
  getAvailableBspMetrics,
} from "../services/aggregation/viewComputer.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import Modal from "./Modal.tsx";

interface CreateViewDialogProps {
  open: boolean;
  buildings: BuildingType[];
  session: Session;
  onClose: () => void;
  onViewCreated: () => void;
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

// Annual metrics any building may carry (read from building.annualData); a sparse
// set the user ticks. Offered for both the annual portfolio and the benchmark.
const ANNUAL_METRICS = [
  {
    category: "Annual Consumption",
    metrics: [
      "electricityConsumption",
      "heatConsumption",
      "waterConsumption",
      "wastewaterConsumption",
    ],
  },
  { category: "Renewable Generation", metrics: ["renewableSelfGeneratedShare"] },
];

const DEFAULT_ANNUAL_METRICS = [
  "electricityConsumption",
  "heatConsumption",
  "waterConsumption",
];
const BSP_METRICS = getAvailableBspMetrics().flatMap((c) => c.metrics);

function metricsForMode(mode: ViewMode) {
  return mode === "benchmark" ? getAvailableBspMetrics() : ANNUAL_METRICS;
}

export default function CreateViewDialog({
  open,
  buildings,
  session,
  onClose,
  onViewCreated,
}: CreateViewDialogProps) {
  const { showNotification } = useNotification();

  // The buildings shared *to* this user (the BSP benchmarks over these), loaded
  // while the dialog is open. Their provenance is the *sharer's*, not BSP — so
  // they don't surface through the owned-building provenance filter below.
  const [bspContributors, setBspContributors] = useState<BspContributors>({
    buildingUris: [],
    contributors: [],
  });
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const c = await bspContributorBuildings(session);
        if (!cancelled) setBspContributors(c);
      } catch {
        // best-effort: a BSP with no received buildings simply has no benchmark
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, session]);

  // URIs (fragment-stripped) of buildings shared to the BSP, for membership tests.
  const bspUriSet = useMemo(
    () => new Set(bspContributors.buildingUris.map((u) => u.split("#")[0])),
    [bspContributors],
  );

  // Buildings the user owns (everything not shared *to* them as a benchmark roster).
  const ownedBuildings = useMemo(
    () => buildings.filter((b) => b.uri && !bspUriSet.has(b.uri.split("#")[0])),
    [buildings, bspUriSet],
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
    if (bspUriSet.size > 0) modes.push("benchmark");
    return modes;
  }, [ownedBuildings, bspUriSet]);

  const [mode, setMode] = useState<ViewMode>("annual");
  const [creating, setCreating] = useState(false);
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
    setSelectedMetrics(next === "benchmark" ? BSP_METRICS : DEFAULT_ANNUAL_METRICS);
    setSelectedPeriod("");
  };

  const handleClose = () => {
    setViewName("");
    setSelectedBuildings([]);
    setAggregationType("average");
    setSelectedMetrics(mode === "benchmark" ? BSP_METRICS : DEFAULT_ANNUAL_METRICS);
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
  const availableBuildings = mode === "benchmark"
    ? buildings.filter((b) => b.uri && bspUriSet.has(b.uri.split("#")[0]))
    : mode === "monthly"
    ? ownedBuildings.filter((b) =>
      (b.energyDatasets ?? []).some((r) => isSeriesGranularity(r.granularity))
    )
    : ownedBuildings;

  // Available months for user-role views: list each user building's 15-min
  // series container(s) and collect the months of the daily files (async — the
  // files are separate resources now, not inline on the building).
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  useEffect(() => {
    if (mode !== "monthly") {
      setAvailableMonths([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const months = new Set<string>();
      for (const b of availableBuildings) {
        const seriesRefs = (b.energyDatasets ?? []).filter((r) =>
          isSeriesGranularity(r.granularity)
        );
        for (const ref of seriesRefs) {
          const container = ref.url.split("#")[0].replace(/\.ttl$/, "/");
          const children = (await listDirectChildren(container, session)) ?? [];
          for (const url of children) {
            if (!url.endsWith(".ttl")) continue;
            const label = url.split("/").pop()!.replace(".ttl", "");
            if (label.length >= 7) months.add(label.substring(0, 7));
          }
        }
      }
      if (!cancelled) setAvailableMonths([...months].sort());
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // The latest annual (non-series) dataset year across the given buildings, as a
  // year string for bench:metricPeriod — undefined if none carry annual data.
  const latestAnnualYear = (buildingUris: string[]): string | undefined => {
    const set = new Set(buildingUris.map((u) => u.split("#")[0]));
    let max: number | undefined;
    for (const b of buildings) {
      if (!b.uri || !set.has(b.uri.split("#")[0])) continue;
      for (const ref of b.energyDatasets ?? []) {
        if (isSeriesGranularity(ref.granularity)) continue;
        if (max === undefined || ref.year > max) max = ref.year;
      }
    }
    return max === undefined ? undefined : String(max);
  };

  const handleCreate = async () => {
    if (!viewName.trim()) {
      showNotification("Please enter a view name", "warning");
      return;
    }
    if (selectedBuildings.length === 0) {
      showNotification("Please select at least one building", "warning");
      return;
    }
    if (mode === "monthly" && !selectedPeriod) {
      showNotification("Please select a month", "warning");
      return;
    }
    if (mode !== "monthly" && selectedMetrics.length === 0) {
      showNotification("Please select at least one metric", "warning");
      return;
    }

    setCreating(true);
    try {
      const metrics = mode === "monthly"
        ? ["electricity"]
        : selectedMetrics;
      const period = mode === "monthly" ? selectedPeriod : undefined;

      const viewDef = await createViewDefinition(
        session,
        viewName.trim(),
        selectedBuildings,
        aggregationType,
        metrics,
        period,
      );

      // BSP benchmark: mark the snapshot as a benchmark result and stamp the year
      // it covers (the latest annual dataset year across the selected buildings).
      const benchmarkOpts = mode === "benchmark"
        ? { benchmark: true, metricPeriod: latestAnnualYear(selectedBuildings) }
        : {};
      await computeAndStoreSnapshot(session, viewDef.id, benchmarkOpts);

      showNotification("View created successfully", "success");
      onViewCreated();
      handleClose();
    } catch (error) {
      console.error("Error creating view:", error);
      showNotification(
        `Failed to create view: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
      );
    } finally {
      setCreating(false);
    }
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
                  label={building ? `Building ${building.id}` : uri}
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
              primary={`Building ${building.id}`}
              secondary={building.streetAddress || building.locality || ""}
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
                ? !selectedPeriod
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

              <TextField
                type="month"
                size="small"
                label="Month"
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: {
                    min: availableMonths[0],
                    max: availableMonths[availableMonths.length - 1],
                  },
                }}
                sx={{ mb: 3, minWidth: 160 }}
              />

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
                              label={metric}
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

import { useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
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
import type { AggregationType, BuildingType } from "../../types/types.ts";
import { createViewDefinition } from "../services/aggregation/viewManager.ts";
import { computeAndStoreSnapshot, getAvailableMetrics, getAvailableInvestorAnnualMetrics, getAvailableBspMetrics } from "../services/aggregation/viewComputer.ts";
import { useSolidData } from "../context/SolidDataContext.tsx";
import { useNotification } from "../context/NotificationContext.tsx";

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

const ROLE_DEFAULT_METRICS: Record<string, string[]> = {
  dummy: ["gas", "electricity"],
  investor: getAvailableInvestorAnnualMetrics().flatMap((c) => c.metrics),
  benchmark_service_provider: getAvailableBspMetrics().flatMap((c) => c.metrics),
};

const ROLE_DESCRIPTION: Record<string, string> = {
  dummy:
    "Create an aggregated view that combines energy data from multiple buildings. " +
    "The computed values are stored as a privacy-preserving snapshot that can be shared " +
    "without revealing the source buildings.",
  investor:
    "Create a portfolio overview comparing energy performance across your buildings. " +
    "Cost-driving and generation metrics are pre-selected.",
  benchmark_service_provider:
    "Create a benchmark view aggregating annual consumption across multiple buildings. " +
    "Metrics: electricity, heat, water, and wastewater consumption (kWh / m³).",
};

export default function CreateViewDialog({
  open,
  buildings,
  session,
  onClose,
  onViewCreated,
}: CreateViewDialogProps) {
  const { role } = useSolidData();
  const { showNotification } = useNotification();

  const defaultMetrics = ROLE_DEFAULT_METRICS[role ?? "dummy"] ?? ["gas", "electricity"];

  const [creating, setCreating] = useState(false);
  const [viewName, setViewName] = useState("");
  const [selectedBuildings, setSelectedBuildings] = useState<string[]>([]);
  const [aggregationType, setAggregationType] = useState<AggregationType>("average");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(defaultMetrics);
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");

  const availableMetrics = role === "benchmark_service_provider"
    ? getAvailableBspMetrics()
    : role === "investor"
      ? getAvailableInvestorAnnualMetrics()
      : getAvailableMetrics();

  const handleClose = () => {
    setViewName("");
    setSelectedBuildings([]);
    setAggregationType("average");
    setSelectedMetrics(defaultMetrics);
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

  // Filter out buildings without URIs
  const availableBuildings = buildings.filter((b) => b.uri);

  // Available months derived from user-role building energyData locations
  const availableMonths = (() => {
    if (role !== "user") return [];
    const months = new Set<string>();
    availableBuildings.forEach((b) => {
      (b.energyData ?? []).forEach((ed) => {
        const label = ed.location.split("/").pop()?.replace(".ttl", "") ?? "";
        if (label.length >= 7) months.add(label.substring(0, 7));
      });
    });
    return [...months].sort();
  })();

  const handleCreate = async () => {
    if (!viewName.trim()) {
      showNotification("Please enter a view name", "warning");
      return;
    }
    if (selectedBuildings.length === 0) {
      showNotification("Please select at least one building", "warning");
      return;
    }
    if (role === "user" && !selectedPeriod) {
      showNotification("Please select a month", "warning");
      return;
    }
    if (role !== "user" && selectedMetrics.length === 0) {
      showNotification("Please select at least one metric", "warning");
      return;
    }

    setCreating(true);
    try {
      const metrics = role === "user" ? ["electricity"] : selectedMetrics;
      const period = role === "user" ? selectedPeriod : undefined;

      const viewDef = await createViewDefinition(
        session,
        viewName.trim(),
        selectedBuildings,
        aggregationType,
        metrics,
        period,
      );

      await computeAndStoreSnapshot(
        session,
        viewDef.id,
        (role === "benchmark_service_provider" || role === "investor") ? buildings : undefined,
      );

      showNotification("View created successfully", "success");
      onViewCreated();
      handleClose();
    } catch (error) {
      console.error("Error creating view:", error);
      showNotification(`Failed to create view: ${error instanceof Error ? error.message : String(error)}`, "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Create Aggregated View</DialogTitle>
      {creating ? (
        <DialogContent>
          <Box
            display="flex"
            flexDirection="column"
            justifyContent="center"
            alignItems="center"
            minHeight={200}
          >
            <CircularProgress />
            <Typography sx={{ mt: 2 }}>Creating view and computing snapshot...</Typography>
          </Box>
        </DialogContent>
      ) : role === "user" ? (
        <>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              Create a view that aggregates monthly electricity consumption across multiple
              buildings. The result is a privacy-preserving snapshot of the combined kWh total.
            </DialogContentText>

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
                      const building = availableBuildings.find((b) => b.uri === uri);
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
                onChange={(e) => setAggregationType(e.target.value as AggregationType)}
              >
                <FormControlLabel value="average" control={<Radio />} label="Average" />
                <FormControlLabel value="sum" control={<Radio />} label="Sum" />
                <FormControlLabel value="min" control={<Radio />} label="Minimum" />
                <FormControlLabel value="max" control={<Radio />} label="Maximum" />
              </RadioGroup>
            </FormControl>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              onClick={handleCreate}
              variant="contained"
              disabled={!viewName.trim() || selectedBuildings.length === 0 || !selectedPeriod}
            >
              Create View
            </Button>
          </DialogActions>
        </>
      ) : (
        <>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              {ROLE_DESCRIPTION[role ?? "dummy"]}
            </DialogContentText>

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
                      const building = availableBuildings.find((b) => b.uri === uri);
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

            <FormControl component="fieldset">
              <FormLabel component="legend">Metrics to Include</FormLabel>
              <Box sx={{ maxHeight: 200, overflow: "auto", mt: 1 }}>
                {availableMetrics.map((category) => {
                  const allSelected = category.metrics.every((m) => selectedMetrics.includes(m));
                  return (
                    <Box key={category.category} sx={{ mb: 2 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography variant="subtitle2" color="textSecondary">
                          {category.category}
                        </Typography>
                        {role === "benchmark_service_provider" && (
                          <Typography
                            variant="caption"
                            color="primary"
                            sx={{ cursor: "pointer", userSelect: "none" }}
                            onClick={() =>
                              setSelectedMetrics((prev) =>
                                allSelected
                                  ? prev.filter((m) => !category.metrics.includes(m))
                                  : [...new Set([...prev, ...category.metrics])]
                              )
                            }
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
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClose}>Cancel</Button>
            <Button
              onClick={handleCreate}
              variant="contained"
              disabled={!viewName.trim() || selectedBuildings.length === 0 || selectedMetrics.length === 0}
            >
              Create View
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  );
}

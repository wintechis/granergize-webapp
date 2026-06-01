import { useMemo, useState } from "react";
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
import type {
  AggregationType,
  BuildingType,
  UserRole,
} from "../../types/types.ts";
import { createViewDefinition } from "../services/aggregation/viewManager.ts";
import {
  computeAndStoreSnapshot,
  getAvailableBspMetrics,
  getAvailableInvestorAnnualMetrics,
  getAvailableMetrics,
} from "../services/aggregation/viewComputer.ts";
import { useNotification } from "../context/NotificationContext.tsx";
import { guardedDialogClose } from "./dialogClose.ts";

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
  benchmark_service_provider: getAvailableBspMetrics().flatMap((c) =>
    c.metrics
  ),
  user: ["electricity"],
};

const ROLE_LABEL: Record<UserRole, string> = {
  dummy: "Demo",
  investor: "Investor",
  benchmark_service_provider: "BSP",
  user: "User",
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
  user: "Create a view that aggregates monthly electricity consumption " +
    "across multiple buildings. The result is a privacy-preserving " +
    "snapshot of the combined kWh total.",
};

function getMetricsForRole(role: UserRole) {
  if (role === "benchmark_service_provider") return getAvailableBspMetrics();
  if (role === "investor") return getAvailableInvestorAnnualMetrics();
  return getAvailableMetrics();
}

export default function CreateViewDialog({
  open,
  buildings,
  session,
  onClose,
  onViewCreated,
}: CreateViewDialogProps) {
  const { showNotification } = useNotification();

  // Derive roles that actually exist in the buildings list
  const availableRoles = useMemo<UserRole[]>(() => {
    const roles = new Set<UserRole>();
    buildings.forEach((b) => {
      if (b.sourceRole) roles.add(b.sourceRole);
    });
    const order: UserRole[] = [
      "dummy",
      "investor",
      "benchmark_service_provider",
      "user",
    ];
    return order.filter((r) => roles.has(r));
  }, [buildings]);

  const initialRole: UserRole = availableRoles[0] ?? "dummy";

  const [selectedRole, setSelectedRole] = useState<UserRole>(initialRole);
  const [creating, setCreating] = useState(false);
  const [viewName, setViewName] = useState("");
  const [selectedBuildings, setSelectedBuildings] = useState<string[]>([]);
  const [aggregationType, setAggregationType] = useState<AggregationType>(
    "average",
  );
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(
    ROLE_DEFAULT_METRICS[initialRole] ?? ["gas", "electricity"],
  );
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");

  const availableMetrics = getMetricsForRole(selectedRole);

  const handleRoleChange = (event: SelectChangeEvent<UserRole>) => {
    const role = event.target.value as UserRole;
    setSelectedRole(role);
    setSelectedBuildings([]);
    setSelectedMetrics(ROLE_DEFAULT_METRICS[role] ?? ["gas", "electricity"]);
    setSelectedPeriod("");
  };

  const handleClose = () => {
    setViewName("");
    setSelectedBuildings([]);
    setAggregationType("average");
    setSelectedMetrics(
      ROLE_DEFAULT_METRICS[selectedRole] ?? ["gas", "electricity"],
    );
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

  // Only buildings matching the selected role
  const availableBuildings = buildings.filter(
    (b) => b.uri && b.sourceRole === selectedRole,
  );

  // Available months derived from user-role building energyData locations
  const availableMonths = (() => {
    if (selectedRole !== "user") return [];
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
    if (selectedRole === "user" && !selectedPeriod) {
      showNotification("Please select a month", "warning");
      return;
    }
    if (selectedRole !== "user" && selectedMetrics.length === 0) {
      showNotification("Please select at least one metric", "warning");
      return;
    }

    setCreating(true);
    try {
      const metrics = selectedRole === "user"
        ? ["electricity"]
        : selectedMetrics;
      const period = selectedRole === "user" ? selectedPeriod : undefined;

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
        (selectedRole === "benchmark_service_provider" ||
            selectedRole === "investor")
          ? availableBuildings
          : undefined,
      );

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

  const roleDropdown = (
    <FormControl fullWidth sx={{ mb: 3 }}>
      <InputLabel id="role-label">Role</InputLabel>
      <Select<UserRole>
        labelId="role-label"
        value={selectedRole}
        onChange={handleRoleChange}
        input={<OutlinedInput label="Role" />}
      >
        {availableRoles.map((r) => (
          <MenuItem key={r} value={r}>
            {ROLE_LABEL[r]}
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
    <Dialog
      open={open}
      onClose={guardedDialogClose(handleClose, {
        dirty: viewName.trim() !== "" || selectedBuildings.length > 0,
        busy: creating,
      })}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>Create Aggregated View</DialogTitle>
      {creating
        ? (
          <DialogContent>
            <Box
              display="flex"
              flexDirection="column"
              justifyContent="center"
              alignItems="center"
              minHeight={200}
            >
              <CircularProgress />
              <Typography sx={{ mt: 2 }}>
                Creating view and computing snapshot...
              </Typography>
            </Box>
          </DialogContent>
        )
        : selectedRole === "user"
        ? (
          <>
            <DialogContent>
              <DialogContentText sx={{ mb: 2 }}>
                {ROLE_DESCRIPTION.user}
              </DialogContentText>

              {roleDropdown}

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
            </DialogContent>
            <DialogActions>
              <Button onClick={handleClose}>Cancel</Button>
              <Button
                onClick={handleCreate}
                variant="contained"
                disabled={!viewName.trim() || selectedBuildings.length === 0 ||
                  !selectedPeriod}
              >
                Create View
              </Button>
            </DialogActions>
          </>
        )
        : (
          <>
            <DialogContent>
              <DialogContentText sx={{ mb: 2 }}>
                {ROLE_DESCRIPTION[selectedRole]}
              </DialogContentText>

              {roleDropdown}

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
                <Box sx={{ maxHeight: 200, overflow: "auto", mt: 1 }}>
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
                          {selectedRole === "benchmark_service_provider" && (
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
            </DialogContent>
            <DialogActions>
              <Button onClick={handleClose}>Cancel</Button>
              <Button
                onClick={handleCreate}
                variant="contained"
                disabled={!viewName.trim() || selectedBuildings.length === 0 ||
                  selectedMetrics.length === 0}
              >
                Create View
              </Button>
            </DialogActions>
          </>
        )}
    </Dialog>
  );
}

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
import { computeAndStoreSnapshot, getAvailableMetrics } from "../services/aggregation/viewComputer.ts";

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

export default function CreateViewDialog({
  open,
  buildings,
  session,
  onClose,
  onViewCreated,
}: CreateViewDialogProps) {
  const [creating, setCreating] = useState(false);
  const [viewName, setViewName] = useState("");
  const [selectedBuildings, setSelectedBuildings] = useState<string[]>([]);
  const [aggregationType, setAggregationType] = useState<AggregationType>("average");
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(["gas", "electricity"]);

  const availableMetrics = getAvailableMetrics();

  const handleClose = () => {
    setViewName("");
    setSelectedBuildings([]);
    setAggregationType("average");
    setSelectedMetrics(["gas", "electricity"]);
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

  const handleCreate = async () => {
    if (!viewName.trim()) {
      alert("Please enter a view name");
      return;
    }
    if (selectedBuildings.length === 0) {
      alert("Please select at least one building");
      return;
    }
    if (selectedMetrics.length === 0) {
      alert("Please select at least one metric");
      return;
    }

    setCreating(true);
    try {
      // Create the view definition
      const viewDef = await createViewDefinition(
        session,
        viewName.trim(),
        selectedBuildings,
        aggregationType,
        selectedMetrics
      );

      // Compute and store the initial snapshot
      await computeAndStoreSnapshot(session, viewDef.id);

      onViewCreated();
      handleClose();
    } catch (error) {
      console.error("Error creating view:", error);
      alert(`Failed to create view: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setCreating(false);
    }
  };

  // Filter out buildings without URIs
  const availableBuildings = buildings.filter((b) => b.uri);

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
      ) : (
        <>
          <DialogContent>
            <DialogContentText sx={{ mb: 2 }}>
              Create an aggregated view that combines energy data from multiple buildings.
              The computed values will be stored as a privacy-preserving snapshot that can be
              shared with others without revealing the source buildings.
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
                {availableMetrics.map((category) => (
                  <Box key={category.category} sx={{ mb: 2 }}>
                    <Typography variant="subtitle2" color="textSecondary">
                      {category.category}
                    </Typography>
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
                ))}
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

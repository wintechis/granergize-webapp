import type { ReactElement } from "react";
import {
  Box,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";

export interface BuildingFieldHelpers {
  /** A labelled text field bound to `fields[field]`. */
  tf: (
    label: string,
    field: string,
    opts?: { type?: string; required?: boolean; error?: boolean; helperText?: string },
  ) => ReactElement;
  /** A checkbox bound to `fields[field]` ("true"/"false"). */
  check: (label: string, field: string) => ReactElement;
  /** A select of `options` (value→label) bound to `fields[field]`, with an
   * accessible `labelId` so the control has a name. */
  enumSelect: (
    label: string,
    field: string,
    options: { value: string; label: string }[],
  ) => ReactElement;
  /** A section heading with a divider. */
  sectionHeader: (title: string) => ReactElement;
}

/**
 * Shared field-render helpers for the building Add/Edit dialogs, so both render
 * text fields, checkboxes, enum selects and section headers identically (one
 * widget vocabulary, per the UI conventions). Closes over the dialog's `fields`
 * map + `setField`; call once in the component body. `idPrefix` namespaces the
 * select `labelId`s so the two dialogs don't collide if both ever mount.
 */
export function makeBuildingFields(
  fields: Record<string, string>,
  setField: (key: string, val: string) => void,
  idPrefix = "building-field",
): BuildingFieldHelpers {
  const tf: BuildingFieldHelpers["tf"] = (label, field, opts) => (
    <TextField
      label={label}
      size="small"
      fullWidth
      required={opts?.required}
      type={opts?.type ?? "text"}
      error={opts?.error}
      helperText={opts?.helperText}
      value={fields[field] ?? ""}
      onChange={(e) => setField(field, e.target.value)}
      sx={{ mb: 1.5 }}
    />
  );

  const check: BuildingFieldHelpers["check"] = (label, field) => (
    <FormControlLabel
      control={
        <Checkbox
          checked={fields[field] === "true"}
          onChange={(e) => setField(field, e.target.checked ? "true" : "false")}
          size="small"
        />
      }
      label={label}
      sx={{ mb: 0.5 }}
    />
  );

  const enumSelect: BuildingFieldHelpers["enumSelect"] = (label, field, options) => (
    <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
      <InputLabel id={`${idPrefix}-${field}-label`}>{label}</InputLabel>
      <Select
        labelId={`${idPrefix}-${field}-label`}
        label={label}
        value={fields[field] ?? ""}
        onChange={(e) => setField(field, e.target.value)}
      >
        <MenuItem value=""><em>—</em></MenuItem>
        {options.map((o) => (
          <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  const sectionHeader: BuildingFieldHelpers["sectionHeader"] = (title) => (
    <Box sx={{ mt: 2, mb: 1 }}>
      <Typography variant="h6" color="text.secondary">{title}</Typography>
      <Divider />
    </Box>
  );

  return { tf, check, enumSelect, sectionHeader };
}

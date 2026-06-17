import {
  Box,
  Checkbox,
  Chip,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  type SelectChangeEvent,
} from "@mui/material";
import type { BuildingType } from "../types.ts";
import { buildingDisplayName } from "../lib/buildingDisplay.ts";

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;
const MenuProps = {
  slotProps: {
    paper: {
      style: {
        maxHeight: ITEM_HEIGHT * 4.5 + ITEM_PADDING_TOP,
        width: 250,
      },
    },
  },
};

interface BaseProps {
  /** The buildings to choose from. */
  buildings: BuildingType[];
  /** Field caption. */
  label: string;
  /** Disable the field (e.g. while a write is in flight). */
  disabled?: boolean;
}

interface MultiProps extends BaseProps {
  multiple: true;
  /** Selected building URIs. */
  value: string[];
  onChange: (uris: string[]) => void;
}

interface SingleProps extends BaseProps {
  multiple?: false;
  /** Selected building URI (or "" for none). */
  value: string;
  onChange: (uri: string) => void;
}

export type BuildingPickerProps = MultiProps | SingleProps;

/**
 * The shared building picker — a MUI `Select` over {@link BuildingType}s keyed by
 * `building.uri` and labelled via {@link buildingDisplayName}. Supports both a
 * **multi**-select (chips + checklist, the aggregation roster) and a **single**
 * select (one building, the palette's share/visibility/revoke param form).
 * Extracted from `CreateAggregationDialog`'s inline multi-select so the two
 * surfaces render the same control.
 */
export default function BuildingPicker(props: BuildingPickerProps) {
  const { buildings, label, disabled } = props;
  const labelId = "building-picker-label";

  if (props.multiple) {
    const { value, onChange } = props;
    const handle = (event: SelectChangeEvent<string[]>) => {
      const v = event.target.value;
      onChange(typeof v === "string" ? v.split(",") : v);
    };
    return (
      <FormControl fullWidth sx={{ mb: 2 }} disabled={disabled}>
        <InputLabel id={labelId}>{label}</InputLabel>
        <Select
          labelId={labelId}
          multiple
          value={value}
          onChange={handle}
          input={<OutlinedInput label={label} />}
          renderValue={(selected) => (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
              {selected.map((uri) => {
                const b = buildings.find((b) => b.uri === uri);
                return (
                  <Chip
                    key={uri}
                    label={b ? buildingDisplayName(b) : uri}
                    size="small"
                  />
                );
              })}
            </Box>
          )}
          MenuProps={MenuProps}
        >
          {buildings.map((b) => (
            <MenuItem key={b.uri} value={b.uri}>
              <Checkbox checked={value.includes(b.uri)} />
              <ListItemText
                primary={buildingDisplayName(b)}
                secondary={b.streetAddress !== buildingDisplayName(b)
                  ? b.streetAddress || b.locality || ""
                  : b.locality || ""}
              />
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  }

  const { value, onChange } = props;
  return (
    <FormControl fullWidth sx={{ mb: 2 }} disabled={disabled}>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        labelId={labelId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        input={<OutlinedInput label={label} />}
        MenuProps={MenuProps}
      >
        {buildings.map((b) => (
          <MenuItem key={b.uri} value={b.uri}>
            <ListItemText
              primary={buildingDisplayName(b)}
              secondary={b.streetAddress !== buildingDisplayName(b)
                ? b.streetAddress || b.locality || ""
                : b.locality || ""}
            />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

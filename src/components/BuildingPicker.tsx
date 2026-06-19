import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  createFilterOptions,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  OutlinedInput,
  Select,
  TextField,
} from "@mui/material";
import { msg } from "../lib/messages.ts";
import type { BuildingType } from "../types.ts";
import { buildingDisplayName } from "../lib/buildingDisplay.ts";

/** Secondary line under a building's name — its street, or locality as fallback. */
const secondaryText = (b: BuildingType): string =>
  b.streetAddress !== buildingDisplayName(b)
    ? b.streetAddress || b.locality || ""
    : b.locality || "";

/** Search matches the name AND the street/locality, not just the display name. */
const filterBuildings = createFilterOptions<BuildingType>({
  stringify: (b) =>
    `${buildingDisplayName(b)} ${b.streetAddress ?? ""} ${b.locality ?? ""}`,
});

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
    // A searchable Autocomplete (type to filter by name/address) scales past the
    // plain checklist dropdown; a Select-all toggle picks the whole set at once.
    const selected = buildings.filter((b) => value.includes(b.uri));
    const allSelected = buildings.length > 0 && selected.length === buildings.length;
    const toggleAll = () => onChange(allSelected ? [] : buildings.map((b) => b.uri));
    return (
      <Box sx={{ mb: 2 }}>
        <Autocomplete<BuildingType, true, false, false>
          multiple
          disableCloseOnSelect
          disabled={disabled}
          options={buildings}
          value={selected}
          onChange={(_, next) => onChange(next.map((b) => b.uri))}
          getOptionLabel={(b) => buildingDisplayName(b)}
          isOptionEqualToValue={(a, b) => a.uri === b.uri}
          filterOptions={filterBuildings}
          renderOption={(optionProps, b, { selected: sel }) => {
            const { key, ...rest } = optionProps;
            return (
              <li key={key} {...rest}>
                <Checkbox checked={sel} size="small" sx={{ mr: 1 }} />
                <ListItemText
                  primary={buildingDisplayName(b)}
                  secondary={secondaryText(b)}
                />
              </li>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label={label}
              placeholder={msg("pickerSearchPlaceholder")}
            />
          )}
        />
        <Button
          size="small"
          onClick={toggleAll}
          disabled={disabled || buildings.length === 0}
          sx={{ mt: 0.5 }}
        >
          {allSelected
            ? msg("pickerClearAll")
            : msg("pickerSelectAll", { count: buildings.length })}
        </Button>
      </Box>
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

import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  createFilterOptions,
  ListItemText,
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
 * The shared building picker — a searchable MUI `Autocomplete` over
 * {@link BuildingType}s keyed by `building.uri`, labelled via
 * {@link buildingDisplayName} and filterable by name / street / locality. Supports
 * both a **multi**-select (chips + checklist + Select-all, the aggregation roster)
 * and a **single** select (one building — the palette param form, the
 * "Add observation" dialog). Both type-to-filter so they scale past a handful of
 * buildings. Extracted from `CreateAggregationDialog`'s inline multi-select.
 */
export default function BuildingPicker(props: BuildingPickerProps) {
  const { buildings, label, disabled } = props;

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
  // A searchable Autocomplete (type to filter by name/address), matching the
  // multi-select above — the plain Select didn't scale past a handful of buildings.
  const selected = buildings.find((b) => b.uri === value) ?? null;
  return (
    <Box sx={{ mb: 2 }}>
      <Autocomplete<BuildingType, false, false, false>
        disabled={disabled}
        options={buildings}
        value={selected}
        onChange={(_, next) => onChange(next?.uri ?? "")}
        getOptionLabel={(b) => buildingDisplayName(b)}
        isOptionEqualToValue={(a, b) => a.uri === b.uri}
        filterOptions={filterBuildings}
        renderOption={(optionProps, b) => {
          const { key, ...rest } = optionProps;
          return (
            <li key={key} {...rest}>
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
    </Box>
  );
}

import { type ReactNode } from "react";
import Box from "@mui/material/Box";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";

/**
 * One coherent toolbar for a data-cube finder's three orthogonal control axes —
 * **Space** × **Time** × **Colour** (see `services/cube/exploreAxes.ts`) — plus a
 * measure-selector slot. Pure presentation: it renders three
 * `ToggleButtonGroup`s and is dumb about the cross-axis rules — the caller passes
 * each option's `disabled` (and may `hidden` a whole group), having resolved them
 * via `axisOptions`. Generic over the axis value vocabularies so a second cube
 * finder (Aggregations: entity=region, geom=choropleth) can reuse the shell with
 * its own labels.
 */
export interface CubeAxisOption<V extends string> {
  readonly value: V;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface CubeAxisGroup<V extends string> {
  readonly value: V;
  readonly options: readonly CubeAxisOption<V>[];
  readonly onChange: (value: V) => void;
  /** The group's accessible name (e2e + a11y target). */
  readonly ariaLabel: string;
  /** Drop the whole group (e.g. Time is meaningless under some Space/Colour). */
  readonly hidden?: boolean;
}

export interface CubeAxisBarProps<
  S extends string = string,
  C extends string = string,
  T extends string = string,
> {
  readonly space: CubeAxisGroup<S>;
  /** Optional Colour axis — a finder with a single view axis (the Buildings Map/List
   *  toggle, the Observations View toggle) passes only `space`. */
  readonly colour?: CubeAxisGroup<C>;
  /** Optional Time axis — a second cube finder (Aggregations: a timeline) can supply
   *  it. */
  readonly time?: CubeAxisGroup<T>;
  /** Measure selector (e.g. the metric `TextField select`) — shown when the
   *  caller supplies it (i.e. the active Colour encodes a measure). */
  readonly metricSlot?: ReactNode;
}

function AxisToggle<V extends string>({ group }: { group: CubeAxisGroup<V> }) {
  if (group.hidden) return null;
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={group.value}
      onChange={(_e, next: V | null) => {
        if (next) group.onChange(next); // ignore deselect of the active button
      }}
      aria-label={group.ariaLabel}
    >
      {group.options.map((o) => (
        <ToggleButton key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

export default function CubeAxisBar<
  S extends string,
  C extends string,
  T extends string,
>(
  { space, colour, time, metricSlot }: CubeAxisBarProps<S, C, T>,
) {
  return (
    <Box
      sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 1.5 }}
    >
      <AxisToggle group={space} />
      {time && <AxisToggle group={time} />}
      {colour && <AxisToggle group={colour} />}
      {metricSlot}
    </Box>
  );
}

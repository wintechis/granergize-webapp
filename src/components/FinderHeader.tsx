import { type ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TitleCount from "./TitleCount.tsx";
import { RdfSourceLink } from "./detail/DetailView.tsx";

/**
 * The shared finder-page **header**, so every tab's chrome reads the same: a
 * **title row** (`h6` title + optional overview-first `(n)` count + dev-mode source
 * link + right-grouped creation `inputs` and `actions`) and an optional **controls
 * row** (search + tier filter + guise toggle). One structure across the six finders
 * (`src/pages/*Finder.tsx`) — extend this rather than hand-rolling a header.
 *
 * Two layout knobs for the Buildings finder, which hosts a full-bleed Leaflet map:
 * - `dense` — `p: 1` instead of `p: 3` (a tighter gutter so the map gets the space).
 * - `ownsScroll` — default `true`: the header IS the scrolling `section` and renders
 *   the list `children` below it. `false` renders only the header chrome
 *   (`flexShrink: 0`); the caller owns the scrolling map/list area beneath.
 */
export interface FinderHeaderProps {
  /** Page title (already-resolved string). Rendered as `Typography variant="h6"`. */
  readonly title: string;
  /** Overview-first item count; renders `<TitleCount>` after the title (hidden ≤ 0). */
  readonly count?: number;
  /** Dev-only RDF source-link target (the component self-hides outside dev mode). */
  readonly source?: string;
  /** Primary/secondary action buttons — right-grouped on the title row. */
  readonly actions?: ReactNode;
  /** Creation inputs (WebID / room name+URI fields + scan) — right-grouped before actions. */
  readonly inputs?: ReactNode;
  /** Search + filters + guise toggle — their own row below the title (omitted when falsy). */
  readonly controls?: ReactNode;
  /** Tighter `p: 1` gutter (the Buildings map). */
  readonly dense?: boolean;
  /** When `true` (default) the header is the scrolling section and renders `children`. */
  readonly ownsScroll?: boolean;
  /** The list body + `Pager` (rendered below the rows when `ownsScroll`). */
  readonly children?: ReactNode;
}

const ROW_SX = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 1.5,
  mb: 1,
} as const;

export default function FinderHeader(
  {
    title,
    count,
    source,
    actions,
    inputs,
    controls,
    dense = false,
    ownsScroll = true,
    children,
  }: FinderHeaderProps,
) {
  const rows = (
    <>
      <Box sx={ROW_SX}>
        <Typography variant="h6">
          {title}
          {count != null && <TitleCount count={count} />}
        </Typography>
        {source && <RdfSourceLink href={source} inline />}
        <Box sx={{ flexGrow: 1 }} />
        {inputs}
        {actions}
      </Box>
      {controls && <Box sx={ROW_SX}>{controls}</Box>}
    </>
  );

  // Buildings: header-only (the caller renders the full-bleed map/list below).
  if (!ownsScroll) {
    return <Box sx={{ p: dense ? 1 : 3, flexShrink: 0 }}>{rows}</Box>;
  }
  return (
    <Box
      component="section"
      sx={{ p: dense ? 1 : 3, flexGrow: 1, minHeight: 0, overflow: "auto" }}
    >
      {rows}
      {children}
    </Box>
  );
}

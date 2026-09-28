import type { CSSProperties } from "react";

/**
 * Shared styles for the app's resource lists (buildings, shared items, data
 * rooms) so they render consistently: an unbulleted list of rows, each with its
 * content on the left and action buttons pushed to the right.
 */

/** Plain unbulleted list (no marker, no indent). */
export const listStyle: CSSProperties = {
  listStyle: "none",
  paddingLeft: 0,
  margin: 0,
};

/** A list nested under a row (e.g. "shared with" under a building). */
export const nestedListStyle: CSSProperties = {
  ...listStyle,
  paddingLeft: "1.25rem",
  marginTop: "0.25rem",
};

/** One row: content left, actions right. */
export const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "0.5rem",
};

/** A group of buttons/controls kept together at the left (not split apart). */
export const buttonRowStyle: CSSProperties = {
  display: "flex",
  gap: "0.5rem",
  flexWrap: "wrap",
};

/** Truncate overflowing text on one line. */
export const ellipsis: CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

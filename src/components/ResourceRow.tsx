import { type ReactNode } from "react";
import { Box, Typography } from "@mui/material";

/**
 * One row in a resource list (buildings, views, contacts, data rooms, shared
 * items): content on the left, action buttons pushed to the right, with optional
 * secondary text, extra left-block content (e.g. a nested "shared with" list),
 * and a full-width expansion below the row. The single row scaffold so every list
 * renders identically — replacing the hand-rolled `<li><div rowStyle>…` copies.
 */
export default function ResourceRow(
  { title, subtitle, children, actions, expansion, buildingId }: {
    title: ReactNode;
    /** Secondary line under the title (auto-wrapped as a caption). */
    subtitle?: ReactNode;
    /** Extra content in the left block, below the subtitle (e.g. NestedAgentList). */
    children?: ReactNode;
    /** Right-aligned action group (icon buttons / buttons). */
    actions?: ReactNode;
    /** Full-width content rendered below the row (e.g. an expansion panel). */
    expansion?: ReactNode;
    /** Rendered as `data-building-id` so e2e specs can target the row. */
    buildingId?: string;
  },
) {
  return (
    <Box
      component="li"
      sx={{ mb: 2 }}
      {...(buildingId ? { "data-building-id": buildingId } : {})}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          {title}
          {subtitle != null && (
            <Typography variant="caption" color="text.secondary" component="div">
              {subtitle}
            </Typography>
          )}
          {children}
        </Box>
        {actions != null && (
          <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>{actions}</Box>
        )}
      </Box>
      {expansion}
    </Box>
  );
}

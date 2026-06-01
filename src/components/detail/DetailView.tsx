import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Divider,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { SxProps, Theme } from "@mui/material/styles";

/**
 * Shared building blocks for detail views (buildings, agents, energy, weather)
 * so they share one consistent visual structure:
 *   DetailCard  → outlined Card + CardHeader (icon + h5 title) + padded content
 *   SectionTitle→ h6 sub-section heading (optionally preceded by a Divider)
 *   DetailRow   → one label/value row
 *   ChartBox    → consistent wrapper around a chart
 *   RefLink     → a relative reference (in-app navigation)
 *   UriLink     → an external URI (opens in a new tab, marked with ↗)
 */

interface DetailCardProps {
  /** Icon shown in the header avatar slot. */
  icon?: ReactNode;
  /** Main heading — rendered at the h5 size. Omit to drop the title. */
  title?: ReactNode;
  /** Optional secondary line under the title. */
  subheader?: ReactNode;
  /** Optional header action slot (e.g. Edit/Share buttons). */
  action?: ReactNode;
  children: ReactNode;
  /** Extra styling for the Card (e.g. the building overlay positioning). */
  sx?: SxProps<Theme>;
  /** Extra styling for the CardContent. */
  contentSx?: SxProps<Theme>;
  /** Spacing between direct children of the content area. */
  spacing?: number;
}

export function DetailCard(
  { icon, title, subheader, action, children, sx, contentSx, spacing = 1 }:
    DetailCardProps,
) {
  // Render the header only when there's something to show — lets callers use a
  // bodyonly card (e.g. when the identity header lives elsewhere).
  const hasHeader = icon != null || title != null || subheader != null ||
    action != null;
  return (
    <Card variant="outlined" sx={sx}>
      {hasHeader && (
        <CardHeader
          avatar={icon}
          action={action}
          title={title != null
            ? <Typography variant="h5">{title}</Typography>
            : undefined}
          subheader={subheader}
        />
      )}
      <CardContent sx={contentSx}>
        <Stack spacing={spacing}>{children}</Stack>
      </CardContent>
    </Card>
  );
}

interface SectionTitleProps {
  children: ReactNode;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Render a Divider above the title to separate it from the previous block. */
  divider?: boolean;
}

export function SectionTitle({ children, icon, divider }: SectionTitleProps) {
  return (
    <Box>
      {divider && <Divider sx={{ mb: 1.5 }} />}
      <Typography
        variant="h6"
        sx={{ display: "flex", alignItems: "center", gap: 1 }}
      >
        {icon}
        {children}
      </Typography>
    </Box>
  );
}

interface DetailRowProps {
  label: ReactNode;
  value: ReactNode;
  /** Use body2 for denser secondary rows. */
  dense?: boolean;
}

export function DetailRow({ label, value, dense }: DetailRowProps) {
  return (
    <Typography
      variant={dense ? "body2" : "body1"}
      sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
    >
      <strong>{label}:</strong>
      {value}
    </Typography>
  );
}

export function ChartBox({ children }: { children: ReactNode }) {
  return <Box sx={{ position: "relative", width: "100%" }}>{children}</Box>;
}

interface RefLinkProps {
  /** In-app route to navigate to (a relative reference). */
  to?: string;
  /** In-place navigation handler; renders the link as a button instead. */
  onClick?: () => void;
  children: ReactNode;
}

/**
 * A link to a relative reference that stays inside the app. Navigates via the
 * client-side router (or an in-place handler) and carries the default link
 * style — no external marker, because it never leaves the app.
 */
export function RefLink({ to, onClick, children }: RefLinkProps) {
  if (onClick) {
    return (
      <Link
        component="button"
        type="button"
        onClick={onClick}
        sx={{ cursor: "pointer", verticalAlign: "baseline" }}
      >
        {children}
      </Link>
    );
  }
  return (
    <Link component={RouterLink} to={to ?? ""}>
      {children}
    </Link>
  );
}

/**
 * A link to an external URI (a vocabulary term, a Pod resource, OpenStreetMap,
 * …). Shares the same link style as {@link RefLink} but opens in a new tab and
 * is marked with a trailing ↗ so external references read differently from the
 * in-app relative ones.
 */
export function UriLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}
    >
      {children}
      {/* eslint-disable-next-line no-restricted-syntax -- icon scales with surrounding text (em), not a fixed tier */}
      <OpenInNewIcon sx={{ fontSize: "0.85em" }} />
    </Link>
  );
}

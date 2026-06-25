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
import { safeHref } from "../../lib/safeHref.ts";
import { useDevMode } from "../../hooks/devMode.ts";
import { useNavTrail, useTrailState } from "../../hooks/navTrail.ts";
import { backTarget, HOME } from "../../routes.ts";

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
  /**
   * Whether to record the current location on the destination's navigation trail
   * (only when `to` is a detail route — see {@link useTrailState}). Default `true`,
   * so a finder/detail link lets the target's back affordance return here. A back
   * link sets it `false`: a back navigation manages the trail itself.
   */
  stamp?: boolean;
  children: ReactNode;
}

/**
 * A link to a relative reference that stays inside the app. Navigates via the
 * client-side router (or an in-place handler) and carries the default link
 * style — no external marker, because it never leaves the app. A link to a detail
 * page records the current location on the destination's navigation trail (in
 * history state, not the URL) so its back affordance returns here (see
 * {@link useTrailState}, {@link BackLink}).
 */
export function RefLink({ to, onClick, children, stamp = true }: RefLinkProps) {
  const trailState = useTrailState();
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
  const state = to && stamp ? trailState(to) : undefined;
  return (
    <Link component={RouterLink} to={to ?? ""} state={state}>
      {children}
    </Link>
  );
}

/**
 * The detail pages' standard back link: a real relative reference back to the most
 * recent location on the navigation trail (carried in history state — so it returns
 * to where the user actually came from), falling back to the page's collection
 * finder for a deep link / fresh tab / shared URL with no trail. Pressing back
 * repeatedly walks the chain by handing the destination the remaining trail. See
 * {@link backTarget}.
 */
export function BackLink({ fallback = HOME }: { fallback?: string }) {
  const trail = useNavTrail();
  const target = backTarget(trail, fallback);
  const rest = trail.slice(0, -1);
  return (
    <Link
      component={RouterLink}
      to={target}
      state={rest.length ? { trail: rest } : undefined}
    >
      🠠 Back
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
  // Shared-Pod IRIs are untrusted: only render an actual link for navigable
  // schemes (http/https/mailto). Anything else (e.g. a `javascript:` subject IRI
  // from another user's data) falls back to plain text — see safeHref.
  const safe = safeHref(href);
  if (!safe) return <>{children}</>;
  return (
    <Link
      href={safe}
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

/**
 * A muted one-line link to a backing RDF resource on the Pod (a Turtle file / LDP
 * container), so the underlying storage is visible and inspectable. The URL is the
 * link text. Developer-mode only — self-hides unless the footer's "Developer mode"
 * toggle is on, so it's the one-call way to expose a backing-resource IRI anywhere.
 *
 * Two placements, ONE style (so every source IRI reads identically): the default
 * sits under a section heading; `inline` sits under a finder row's title. The only
 * difference is structural — a row title may already render inside a `<p>`, so the
 * inline form is a block-level `<span>` (a nested `<p>` is invalid HTML) with no
 * bottom margin; the muted `body2`/secondary look is shared.
 */
export function RdfSourceLink(
  { href, inline }: { href: string; inline?: boolean },
) {
  const dev = useDevMode();
  if (!dev) return null;
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      component={inline ? "span" : "p"}
      sx={{ display: "block", mb: inline ? 0 : 1, wordBreak: "break-all" }}
    >
      <UriLink href={href}>{href}</UriLink>
    </Typography>
  );
}

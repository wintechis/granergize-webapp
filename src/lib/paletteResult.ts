/**
 * Render a launched **read** intent's return value as a small, uniform result view
 * for the command palette's launcher (the `runLaunch` read branch, plan-intent-core
 * §10). Pure — the React component maps {@link ReadResultView} to MUI rows. The two
 * open-tier finds get first-class rows (label + a context line); any other read
 * falls back to a best-effort label per item.
 *
 * The launcher is a Developer-mode surface (the palette's `{`/`>` field modes), so
 * composed titles stay plain strings; item labels that are i18n `MessageId`s (the
 * regional dataset metric) are localised through `t`.
 */
import type { TFn } from "../context/I18nProvider.tsx";
import type { NearbyInstallation } from "../services/mastrNearby.ts";
import type { OpenRegionalItem } from "../services/openRegional.ts";

/** One result line — a primary label and an optional context line. */
export interface ReadResultRow {
  primary: string;
  secondary?: string;
}

/** A launched read's value, reduced to a title + rows the palette renders. */
export interface ReadResultView {
  title: string;
  rows: ReadResultRow[];
}

const km = (n: number) => `${n.toFixed(1)} km`;
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

export function summarizeReadResult(
  name: string,
  value: unknown,
  t: TFn,
): ReadResultView {
  if (value == null) return { title: "No result", rows: [] };

  if (name === "FindNearbyInstallations" && Array.isArray(value)) {
    const items = value as NearbyInstallation[];
    return {
      title: plural(items.length, "nearby installation"),
      rows: items.map((i) => ({
        primary: i.label,
        secondary: `${i.kind} · ${km(i.distanceKm)}`,
      })),
    };
  }

  if (name === "FindRegionalStatistics" && Array.isArray(value)) {
    const items = value as OpenRegionalItem[];
    return {
      title: plural(items.length, "regional dataset"),
      rows: items.map((it) => ({ primary: t(it.labelId), secondary: it.region })),
    };
  }

  // Fallback: any other read — a count + a best-effort label per array item.
  if (Array.isArray(value)) {
    return {
      title: plural(value.length, "result"),
      rows: value.map((v) => ({ primary: bestLabel(v) })),
    };
  }
  return { title: "1 result", rows: [{ primary: bestLabel(value) }] };
}

/** Best-effort one-line label for an arbitrary read item (fallback path). */
function bestLabel(v: unknown): string {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of ["label", "name", "region", "displayName", "uri", "id"]) {
      if (typeof o[k] === "string") return o[k] as string;
    }
  }
  return JSON.stringify(v);
}

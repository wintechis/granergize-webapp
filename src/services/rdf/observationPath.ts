/**
 * Time-first paths for first-class observation collections.
 *
 * Phase-0 contract **C2** of the redesign (signatures frozen here; the
 * data-layer migration that switches readers/writers onto them is the
 * L-observations lane — see `plans/plan-redesign-parallel-execution.md`).
 *
 * Layout (decided 2026-06-14, `plans/plan-app-design-overhaul.md` §4): observations
 * live at top-level `<app>observations/` and partition **time-first**, with the
 * dataset `{id}` at the leaf and depth following resolution:
 *
 *   annual   `observations/{year}/{id}.ttl`
 *   monthly  `observations/{year}/{month}/{id}.ttl`
 *   daily    `observations/{year}/{month}/{day}/{id}.ttl`
 *
 * A *period container* (`observations/{year}/`, `observations/{year}/{month}/`) is the
 * rollup target across the owner's datasets for that period. `{month}`/`{day}` are
 * zero-padded for calendar-legible IRIs (`observations/2024/06/13/…`). Scenario
 * (actual/planned) is a property of the dataset, captured by which `{id}`, not by the
 * path. `observationsRoot` is `podResources(webId).observations` (trailing slash).
 */

/** A point in the time hierarchy + the dataset id (deeper fields require shallower ones). */
export interface ObservationRef {
  year: number;
  /** 1-12; required for `day`. */
  month?: number;
  /** 1-31; requires `month`. */
  day?: number;
  /** The dataset id (UUID stem) at the leaf. */
  id: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** Resource IRI for one observation-collection leaf at its resolution. */
export function observationUri(
  observationsRoot: string,
  ref: ObservationRef,
): string {
  const { year, month, day, id } = ref;
  if (day != null && month == null) {
    throw new Error("observationUri: `day` requires `month`");
  }
  const segs = [String(year)];
  if (month != null) segs.push(pad(month));
  if (day != null) segs.push(pad(day));
  segs.push(`${id}.ttl`);
  return `${observationsRoot}${segs.join("/")}`;
}

/** The period *container* (rollup target). Empty period → the `observations/` root. */
export function observationContainer(
  observationsRoot: string,
  period: { year?: number; month?: number; day?: number } = {},
): string {
  const { year, month, day } = period;
  if (month != null && year == null) {
    throw new Error("observationContainer: `month` requires `year`");
  }
  if (day != null && month == null) {
    throw new Error("observationContainer: `day` requires `month`");
  }
  const segs: string[] = [];
  if (year != null) segs.push(String(year));
  if (month != null) segs.push(pad(month));
  if (day != null) segs.push(pad(day));
  return segs.length ? `${observationsRoot}${segs.join("/")}/` : observationsRoot;
}

/** Inverse of {@link observationUri}: parse a leaf IRI back to its {@link ObservationRef}. */
export function parseObservationUri(
  observationsRoot: string,
  uri: string,
): ObservationRef | null {
  const hashless = uri.split("#")[0];
  if (!hashless.startsWith(observationsRoot)) return null;
  const parts = hashless.slice(observationsRoot.length).split("/");
  const file = parts.pop();
  const id = file?.replace(/\.ttl$/, "") ?? "";
  if (!id) return null;
  const [yearStr, monthStr, dayStr] = parts;
  const year = Number(yearStr);
  if (!/^\d{4}$/.test(yearStr ?? "") || !Number.isInteger(year)) return null;
  const ref: ObservationRef = { year, id };
  if (monthStr != null) {
    if (!/^\d{2}$/.test(monthStr)) return null;
    ref.month = Number(monthStr);
  }
  if (dayStr != null) {
    if (ref.month == null || !/^\d{2}$/.test(dayStr)) return null;
    ref.day = Number(dayStr);
  }
  return ref;
}

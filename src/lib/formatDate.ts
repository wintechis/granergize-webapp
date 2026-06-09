/**
 * User-facing date formatting in ISO 8601 (RFC 3339) style — `2026-06-09` for a
 * calendar date, `2026-06-09 14:30` for a timestamp — never the locale-dependent
 * `M/D/YYYY` that `toLocaleDateString()` yields. We have an education mandate to
 * keep wording precise; ISO 8601 is unambiguous across regions.
 *
 * Both use local time (matching what `toLocaleDateString`/`toLocaleString` showed),
 * so a stored UTC timestamp renders on the day/time the viewer sees it. An
 * unparseable value yields "".
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** ISO 8601 calendar date, local time: `2026-06-09`. */
export function formatDate(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** ISO 8601 date + minute-precision time, local: `2026-06-09 14:30`. */
export function formatDateTime(value: string | number | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

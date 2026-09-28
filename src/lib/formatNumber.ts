/**
 * User-facing number formatting, always `de-DE` (decimal comma, dot thousands
 * separator) so figures read the same on every screen. `Intl.NumberFormat`
 * construction is expensive and these run per table cell per render, so the
 * formatters are memoized module-wide, keyed by their fraction-digit config.
 */

const formatters = new Map<string, Intl.NumberFormat>();

function getFormatter(minDigits: number, maxDigits: number): Intl.NumberFormat {
  const key = `${minDigits}-${maxDigits}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("de-DE", {
      minimumFractionDigits: minDigits,
      maximumFractionDigits: maxDigits,
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** Fixed-width fraction: exactly `decimals` fraction digits (min = max). */
export function formatNumber(value: number, decimals = 0): string {
  return getFormatter(decimals, decimals).format(value);
}

/** Trailing-zero-free fraction: up to `maxDecimals` fraction digits (min 0). */
export function formatNumberMax(value: number, maxDecimals: number): string {
  return getFormatter(0, maxDecimals).format(value);
}

/**
 * A relative change as a **signed percentage** — `"+12 %"`, `"−12 %"`, `"±0 %"`.
 * Takes the FRACTION (`0.12` → `"+12 %"`), formats the digits de-DE like every other
 * figure, uses a real minus (U+2212) rather than a hyphen, and a non-breaking space
 * before the `%` (DIN 5008). A change that rounds to zero reads `"±0 %"` — `"+0 %"`
 * would claim a direction the rounded figure doesn't show.
 */
export function formatSignedPercent(fraction: number, decimals = 0): string {
  const pct = fraction * 100;
  const rounded = Number(pct.toFixed(decimals));
  const sign = rounded === 0 ? "±" : rounded > 0 ? "+" : "−";
  return `${sign}${formatNumber(Math.abs(rounded), decimals)}\u00A0%`;
}

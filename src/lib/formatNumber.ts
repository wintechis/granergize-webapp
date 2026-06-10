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

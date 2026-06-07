/** MIME type for `.xlsx` workbooks (OpenXML spreadsheet). */
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Trigger a browser download of `bytes` as `filename`, served as an `.xlsx`
 * blob. Shared by the Manage and Share tabs' building exports.
 */
export function downloadXlsx(bytes: ArrayBuffer, filename: string): void {
  downloadBlob(new Blob([bytes], { type: XLSX_MIME }), filename);
}

/** Human-readable byte size (e.g. "1.2 MB"); empty string for 0/unknown. */
export function formatBytes(n: number): string {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Trigger a browser download of an arbitrary `blob` as `filename`. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

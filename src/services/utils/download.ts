/** MIME type for `.xlsx` workbooks (OpenXML spreadsheet). */
export const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Trigger a browser download of `bytes` as `filename`, served as an `.xlsx`
 * blob. Shared by the Manage and Share tabs' building exports.
 */
export function downloadXlsx(bytes: ArrayBuffer, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

import { logError } from "./logError.ts";

/** The WebIDs in `webIds` that aren't syntactically valid absolute URIs. */
export function invalidWebIds(webIds: string[]): string[] {
  return webIds.filter((w) => {
    try {
      new URL(w);
      return false;
    } catch (err) {
      logError("validate recipient WebID", err);
      return true;
    }
  });
}

/**
 * `null` when every entry is a syntactically valid WebID, else the
 * `"Invalid WebID(s): …"` message the share dialogs surface — the shared
 * recipient-WebID validation behind ShareBuildingDialog and ShareViewDialog.
 */
export function webIdsError(webIds: string[]): string | null {
  const invalid = invalidWebIds(webIds);
  if (invalid.length === 0) return null;
  return `Invalid WebID${invalid.length > 1 ? "s" : ""}: ${invalid.join(", ")}`;
}

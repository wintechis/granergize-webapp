/**
 * Utility functions for working with Solid POD URLs and WebIDs
 */
import { getPodUrlAll } from "@inrupt/solid-client";

/**
 * Extract the storage root URL from a WebID
 * Example: 
 *   Input: https://solid.ti.rw.fau.de/homer/profile/card#me
 *   Output: https://solid.ti.rw.fau.de/homer/
 * 
 * @param webId - The WebID URL (with or without fragment)
 * @returns The storage root URL with trailing slash
 */
export function getStorageRoot(webId: string): string {
  const webIdWithoutFragment = webId.split("#")[0];
  const pathParts = webIdWithoutFragment.split("/");
  // protocol://domain/username/
  return pathParts.slice(0, 4).join("/") + "/";
}

/**
 * Extract the base URL from a WebID (parent directory of the WebID document)
 * Example:
 *   Input: https://solid.ti.rw.fau.de/homer/profile/card#me
 *   Output: https://solid.ti.rw.fau.de/homer/profile/
 * 
 * This is useful when you need the directory containing the WebID document,
 * not the storage root.
 * 
 * @param webId - The WebID URL (with or without fragment)
 * @returns The base URL with trailing slash
 */
export function getPodBaseUrl(webId: string): string {
  return webId.substring(0, webId.lastIndexOf("/") + 1);
}

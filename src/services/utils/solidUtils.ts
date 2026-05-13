/**
 * Utility functions for working with Solid POD URLs and WebIDs
 */

/**
 * Extract the storage root URL from a WebID.
 * Works for both subdomain-based and path-based PODs by locating
 * the conventional /profile/ segment in the WebID path.
 *
 * Examples:
 *   https://homer.solid.example.org/profile/card#me → https://homer.solid.example.org/
 *   https://solid.example.org/homer/profile/card#me → https://solid.example.org/homer/
 *
 * @param webId - The WebID URL (with or without fragment)
 * @returns The storage root URL with trailing slash
 */
export function getStorageRoot(webId: string): string {
  const url = new URL(webId);
  const profileIndex = url.pathname.indexOf("/profile/");
  if (profileIndex !== -1) {
    return url.origin + url.pathname.substring(0, profileIndex + 1);
  }
  return url.origin + "/";
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

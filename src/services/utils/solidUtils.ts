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

/**
 * The data-source registry URL (`<pod>/profile/granergize/dataSources.ttl`) for a
 * WebID. Single source of truth: callers previously built this path two ways
 * (`getPodBaseUrl + "granergize/…"` vs `getStorageRoot + "profile/granergize/…"`),
 * which coincide only for `<pod>/profile/card`-shaped WebIDs. Always derive it
 * here from `getPodBaseUrl`, the directory holding the WebID document.
 */
export function registryUrl(webId: string): string {
  return `${getPodBaseUrl(webId)}granergize/dataSources.ttl`;
}

/**
 * Canonical URLs of the app's on-Pod RDF resources for a WebID, so the UI can
 * link to them (surfacing how data is stored as RDF). The bases match what the
 * services actually read/write — note the deliberate `getPodBaseUrl` vs
 * `getStorageRoot` split (see data-layout.md "Two roots"); keep this in sync with
 * the writers in TurtleParsingService / buildingSerializer / viewManager /
 * sharingManager / dataRoom.
 */
export function podResources(webId: string): {
  registry: string;
  buildings: string;
  views: string;
  viewDefinitions: string;
  computedViews: string;
  sharingRegistry: string;
  rooms: string;
  hiddenBuildings: string;
} {
  const root = getStorageRoot(webId);
  const base = getPodBaseUrl(webId);
  return {
    registry: registryUrl(webId), // profile/granergize/dataSources.ttl
    buildings: `${root}granergize/buildings/`,
    views: `${root}granergize/views/`,
    viewDefinitions: `${root}granergize/views/viewDefinitions.ttl`,
    computedViews: `${root}granergize/views/computed/`,
    sharingRegistry: `${base}granergize/sharingRegistry.ttl`,
    rooms: `${root}granergize/rooms.ttl`,
    hiddenBuildings: `${root}profile/granergize/hiddenBuildings.ttl`,
  };
}

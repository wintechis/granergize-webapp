import { useSyncExternalStore } from "react";
import { getDefaultSession } from "@inrupt/solid-client-authn-browser";
import {
  type ActiveRequest,
  getActivitySnapshot,
  getRequestLog,
  type RequestLogEntry,
  subscribeActivity,
} from "../services/utils/networkActivity.ts";
import { getStorageRoot } from "../services/utils/solidUtils.ts";
import { logError } from "../services/utils/logError.ts";

/** Subscribe to the in-flight request list (re-renders on change). */
export function useNetworkActivity(): ActiveRequest[] {
  return useSyncExternalStore(
    subscribeActivity,
    getActivitySnapshot,
    getActivitySnapshot,
  );
}

/** Subscribe to the finished-request history (re-renders on change). */
export function useRequestLog(): RequestLogEntry[] {
  return useSyncExternalStore(subscribeActivity, getRequestLog, getRequestLog);
}

/** The resolved Pod storage root, or "" if not available yet. */
export function currentStorageRoot(): string {
  try {
    const webId = getDefaultSession().info.webId;
    return webId ? getStorageRoot(webId) : "";
  } catch (err) {
    logError("read storage root for request log display", err);
    return "";
  }
}

/**
 * Display text for one request: requests under the Pod show as a relative path
 * (`METHOD granergize/…`); anything else (external URLs, or label-only entries
 * like "map tiles") shows in full.
 */
export function displayLabel(r: ActiveRequest, root: string): string {
  if (!r.url) return r.label;
  const method = r.label.split(" ")[0];
  const noQuery = r.url.split("#")[0].split("?")[0];
  const where = root && noQuery.startsWith(root)
    ? noQuery.slice(root.length)
    : noQuery;
  return `${method} ${where}`;
}

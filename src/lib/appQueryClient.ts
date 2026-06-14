import type { QueryClient } from "@tanstack/react-query";

/**
 * The app's single React Query client, published once at `QueryProvider` mount so
 * non-hook service code (the aggregated-view compute) can read the warm cache —
 * the same single-read-path the hooks use — instead of issuing its own weaker Pod
 * read. Mirrors the `getSession()` singleton in `hooks/session.ts`.
 *
 * Null when no provider is mounted (headless / unit contexts); callers must treat
 * a null client as "no cache" and fall back to a direct fetch.
 */
let appQueryClient: QueryClient | null = null;

/** Publish (or clear, with `null`) the app's QueryClient. Called by QueryProvider. */
export function _setAppQueryClient(qc: QueryClient | null): void {
  appQueryClient = qc;
}

/** The app's QueryClient, or null outside a mounted provider. */
export function getAppQueryClient(): QueryClient | null {
  return appQueryClient;
}

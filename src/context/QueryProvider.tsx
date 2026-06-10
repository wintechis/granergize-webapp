import { useState } from "react";
import {
  keepPreviousData,
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { SessionExpiredError } from "../services/TurtleParsingService.ts";
import {
  classifyMutationError,
  classifyQueryError,
} from "../hooks/queryErrors.ts";
import { useNotification } from "./NotificationContext.tsx";

/**
 * Owns the single React Query client and routes query/mutation errors to the
 * notification snackbar — `SessionExpiredError` (token expired) as a warning,
 * `ConflictError` (concurrent write lost the optimistic-lock race) and everything
 * else as errors. `keepPreviousData` means a failed refetch leaves the last good
 * data on screen (e.g. the map keeps its buildings after a 401) instead of
 * blanking. Lives inside `NotificationProvider` so it can use `useNotification`.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const { showNotification } = useNotification();

  const [client] = useState(() => {
    const notify = (error: unknown) => {
      const { message, severity } = classifyQueryError(error);
      showNotification(message, severity);
    };

    return new QueryClient({
      queryCache: new QueryCache({ onError: notify }),
      // Mutations carry MutationNotificationMeta: `action` gives the toast the
      // standard "Failed to {action}: {detail}" phrasing; `silent` hands the
      // error to the dialog's inline <Alert> instead of toasting.
      mutationCache: new MutationCache({
        onError: (error, _variables, _context, mutation) => {
          const note = classifyMutationError(error, mutation.meta);
          if (note) showNotification(note.message, note.severity);
        },
      }),
      defaultOptions: {
        queries: {
          // Freshness is server-driven, not a client guess. The Pod sends only
          // ETag / Last-Modified (no Cache-Control / Expires), so there is no
          // freshness window to fabricate — `staleTime: 0` is honest. Instead of
          // a made-up timer, refetching is driven by EVENTS:
          //  - `refetchOnMount: false` — revisiting a tab serves the cached data
          //    (no refetch just because a component remounted),
          //  - `gcTime: Infinity` — cache is kept for the whole session so that
          //    cache is actually there to serve,
          //  - focus/reconnect refetch off,
          //  - writes invalidate their own queries precisely (the only refetch
          //    trigger), and the refetch is a conditional GET (fetchFresh →
          //    If-None-Match → 304) so it's cheap and server-validated.
          // Net: fetch on first need + after a write; never on tab switch/focus.
          staleTime: 0,
          gcTime: Infinity,
          refetchOnMount: false,
          refetchOnWindowFocus: false,
          refetchOnReconnect: false,
          placeholderData: keepPreviousData,
          // Don't hammer an expired session; let other failures retry once.
          retry: (count, error) =>
            !(error instanceof SessionExpiredError) && count < 1,
        },
      },
    });
  });

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

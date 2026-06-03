import { useState } from "react";
import {
  keepPreviousData,
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { SessionExpiredError } from "../services/TurtleParsingService.ts";
import { ConflictError } from "../services/utils/podWrite.ts";
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
      if (error instanceof SessionExpiredError) {
        showNotification(error.message, "warning");
      } else if (error instanceof ConflictError) {
        showNotification(
          "This changed elsewhere — please reload and try again.",
          "warning",
        );
      } else {
        showNotification(
          error instanceof Error ? error.message : String(error),
          "error",
        );
      }
    };

    return new QueryClient({
      queryCache: new QueryCache({ onError: notify }),
      mutationCache: new MutationCache({ onError: notify }),
      defaultOptions: {
        queries: {
          staleTime: 2 * 60 * 1000, // 2 min — Pod data is fairly static per session
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

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Session } from "@inrupt/solid-client-authn-browser";
import {
  fetchAndParseData,
  SessionExpiredError,
} from "../services/TurtleParsingService.ts";
import { resolveStorageRoot } from "../services/utils/solidUtils.ts";
import { useNotification } from "./NotificationContext.tsx";
import type {
  AgentType,
  BuildingType,
  EnergyType,
} from "../../types/types.ts";

interface ContextState {
  buildings: BuildingType[];
  energyNeed: EnergyType[];
  agents: AgentType[];
  averages: Record<string, number>;
  agentAverages: Record<string, Record<string, number>>;
  isLoading: boolean;
  error: string | null;
  reloadData: () => Promise<void>;
}

const SolidDataContext = createContext<ContextState>({
  buildings: [],
  energyNeed: [],
  agents: [],
  averages: {},
  agentAverages: {},
  isLoading: false,
  error: null,
  reloadData: async () => {},
});

export const useSolidData = () => useContext(SolidDataContext);

interface SolidDataProviderProps {
  session: Session | null;
  children: React.ReactNode;
}

export const SolidDataProvider: React.FC<SolidDataProviderProps> = ({
  session,
  children,
}) => {
  const [data, setData] = useState<
    Omit<ContextState, "isLoading" | "error" | "reloadData">
  >({
    buildings: [],
    energyNeed: [],
    agents: [],
    averages: {},
    agentAverages: {},
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { showNotification } = useNotification();

  const loadData = useCallback(async () => {
    if (!session || !session.info.isLoggedIn) {
      setError("Not authenticated");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Resolve the Pod storage root from pim:storage once, before any path is
      // built. Throws (and surfaces below) if the profile declares no storage.
      await resolveStorageRoot(session);
      const parsedData = await fetchAndParseData(session, (partial) => {
        // Phase 1: buildings + agents are ready — show the map immediately and
        // drop the loading overlay; energy data fills in when phase 2 resolves.
        setData((prev) => ({
          ...prev,
          buildings: partial.buildings,
          agents: partial.agents,
        }));
        setIsLoading(false);
      });
      // Phase 2: energy data and averages are now included.
      setData(parsedData);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        // Token expired: keep whatever is already on screen (don't blank the
        // map) and tell the user to log in again.
        setError(err.message);
        showNotification(err.message, "warning");
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Error loading data: ${message}`);
        showNotification(`Error loading data: ${message}`, "error");
        console.error("Error loading data:", err);
      }
    } finally {
      setIsLoading(false);
    }
  }, [session, showNotification]);

  useEffect(() => {
    if (session?.info.isLoggedIn) {
      loadData();
    }
  }, [session?.info.isLoggedIn, loadData]);

  return (
    <SolidDataContext.Provider
      value={{
        ...data,
        isLoading,
        error,
        reloadData: loadData,
      }}
    >
      {children}
    </SolidDataContext.Provider>
  );
};

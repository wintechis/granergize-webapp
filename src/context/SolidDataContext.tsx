import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Session } from "@inrupt/solid-client-authn-browser";
import { fetchAndParseData } from "../services/TurtleParsingService.ts";
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

  const loadData = useCallback(async () => {
    if (!session || !session.info.isLoggedIn) {
      setError("Not authenticated");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
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
      const message = err instanceof Error ? err.message : String(err);
      setError(`Error loading data: ${message}`);
      console.error("Error loading data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [session]);

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

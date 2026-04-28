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
  parseEnergyMix,
} from "../services/TurtleParsingService.ts";
import type {
  AgentType,
  BuildingType,
  EnergyConsumption,
  EnergyProduction,
  EnergyType,
} from "../../types/types.ts";

interface ContextState {
  buildings: BuildingType[];
  energyNeed: EnergyType[];
  agents: AgentType[];
  averages: Record<string, number>;
  agentAverages: Record<string, Record<string, number>>;
  energyMix: {
    energyConsumption: Record<string, EnergyConsumption>;
    energyProduction: Record<string, EnergyProduction>;
  } | null;
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
  energyMix: null,
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
    Omit<ContextState, "isLoading" | "error" | "reloadData" | "energyMix">
  >({
    buildings: [],
    energyNeed: [],
    agents: [],
    averages: {},
    agentAverages: {},
  });
  const [energyMix, setEnergyMix] = useState<ContextState["energyMix"]>(null);
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
      const parsedData = await fetchAndParseData(session);
      setData(parsedData);

      const mix = await parseEnergyMix(session);
      setEnergyMix(mix);
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
        energyMix,
        isLoading,
        error,
        reloadData: loadData,
      }}
    >
      {children}
    </SolidDataContext.Provider>
  );
};

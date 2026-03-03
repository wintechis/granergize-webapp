import React, { createContext, useContext, useEffect, useState } from "react";
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
  UserRole,
} from "../../types/types.ts";

const ROLE_STORAGE_KEY = "granergize.role";

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
  role: UserRole | null;
  setRole: (role: UserRole | null) => void;
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
  role: null,
  setRole: () => {},
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
    Omit<ContextState, "isLoading" | "error" | "reloadData" | "energyMix" | "role" | "setRole">
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
  const [role, setRoleState] = useState<UserRole | null>(() => {
    try {
      return (localStorage.getItem(ROLE_STORAGE_KEY) as UserRole | null) ?? null;
    } catch {
      return null;
    }
  });

  const setRole = (newRole: UserRole | null) => {
    try {
      if (newRole === null) {
        localStorage.removeItem(ROLE_STORAGE_KEY);
      } else {
        localStorage.setItem(ROLE_STORAGE_KEY, newRole);
      }
    } catch {
      // localStorage unavailable — proceed in-memory only
    }
    setRoleState(newRole);
  };

  const loadData = async () => {
    if (!session || !session.info.isLoggedIn) {
      setError("Not authenticated");
      return;
    }

    if (role === null) {
      // No role selected yet — nothing to load
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Load primary data filtered by role
      const parsedData = await fetchAndParseData(session, role);
      setData(parsedData);

      // Load energy mix data
      const mix = await parseEnergyMix(session);
      setEnergyMix(mix);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Error loading data: ${message}`);
      console.error("Error loading data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  // Reload when session becomes logged in or role changes
  useEffect(() => {
    if (session?.info.isLoggedIn && role !== null) {
      loadData();
    }
  }, [session?.info.isLoggedIn, role]);

  return (
    <SolidDataContext.Provider
      value={{
        ...data,
        energyMix,
        isLoading,
        error,
        reloadData: loadData,
        role,
        setRole,
      }}
    >
      {children}
    </SolidDataContext.Provider>
  );
};

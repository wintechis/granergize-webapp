import React, { createContext, useContext, useState, useEffect } from 'react';
import { Session } from '@inrupt/solid-client-authn-browser';
import { fetchAndParseData, parseEnergyMix } from '../services/TurtleParsingService.ts';
import type { BuildingType, EnergyType } from '../../types/types.ts';

interface ContextState {
  buildings: BuildingType[];
  energyNeed: EnergyType[];
  weather: any[];
  agents: any[];
  averages: Record<string, number>;
  agentAverages: Record<string, Record<string, number>>;
  energyMix: {
    energyConsumption: Record<string, {value: number, renewableEnergyShare: number}>;
    energyProduction: Record<string, any>;
  } | null;
  isLoading: boolean;
  error: string | null;
  reloadData: () => Promise<void>;
}

const SolidDataContext = createContext<ContextState>({
  buildings: [],
  energyNeed: [],
  weather: [],
  agents: [],
  averages: {},
  agentAverages: {},
  energyMix: null,
  isLoading: false,
  error: null,
  reloadData: async () => {}
});

export const useSolidData = () => useContext(SolidDataContext);

interface SolidDataProviderProps {
  session: Session;
  children: React.ReactNode;
}

export const SolidDataProvider: React.FC<SolidDataProviderProps> = ({ 
  session, 
  children 
}) => {
  const [data, setData] = useState<Omit<ContextState, 'isLoading' | 'error' | 'reloadData' | 'energyMix'>>({
    buildings: [],
    energyNeed: [],
    weather: [],
    agents: [],
    averages: {},
    agentAverages: {},
  });
  const [energyMix, setEnergyMix] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = async () => {
    if (!session || !session.info.isLoggedIn) {
      setError("Not authenticated");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Load primary data
      const parsedData = await fetchAndParseData(session);
      setData(parsedData);

      console.log("weather:", parsedData.weather);

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

  // Initial load
  useEffect(() => {
    if (session?.info.isLoggedIn) {
      loadData();
    }
  }, [session?.info.isLoggedIn]);

  return (
    <SolidDataContext.Provider
      value={{
        ...data,
        energyMix,
        isLoading,
        error,
        reloadData: loadData
      }}
    >
      {children}
    </SolidDataContext.Provider>
  );
};
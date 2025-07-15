import { Session } from "@inrupt/solid-client-authn-browser";
import { parseBuildings } from "./utils/buildingParser.ts";
import { parseAgents } from "./utils/agentParser.ts";
import { parseEnergyData } from "./utils/energyDataParser.ts";
import type { EnergyType } from "../../types/types.ts";
import { DataFactory, Store, Parser, Term } from "n3";
import type { Quad } from "@rdfjs/types";

const { namedNode } = DataFactory;

/**
 * Attempts to load Turtle data from multiple sources, continuing if some fail
 */
async function loadTtlFromMultipleSources(
    urls: string[],
    session: Session,
    description: string
  ): Promise<Quad[]> {
    const allQuads: Quad[] = [];
    const successfulSources: string[] = [];
    const failedSources: { url: string; error: string }[] = [];
  
  // Try each source independently
  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await session.fetch(url);
        if (!response.ok) {
          failedSources.push({ 
            url, 
            error: `HTTP ${response.status}: ${response.statusText}` 
          });
          return;
        }
        
        const text = await response.text();
        const parser = new Parser({
          baseIRI: url,
        });
        
        // Parse with default graph set to the URL
        const quads = parser.parse(text);
        
        // Add source information to each quad
        const quadsWithGraph = quads.map((quad: Quad) => {
          // Create a new quad with the source URL as the graph
          return DataFactory.quad(
            quad.subject,
            quad.predicate,
            quad.object,
            DataFactory.namedNode(url)
          );
        });
        
        // Add these quads to our collection
        allQuads.push(...quadsWithGraph);
        successfulSources.push(url);
      } catch (error) {
        failedSources.push({ 
          url, 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    })
  );

  // Log results
  if (successfulSources.length > 0) {
    console.log(`Successfully loaded ${description} from ${successfulSources.length} sources:`, 
      successfulSources);
  }
  
  if (failedSources.length > 0) {
    console.warn(`Failed to load ${description} from ${failedSources.length} sources:`, 
      failedSources);
  }

  if (allQuads.length === 0 && urls.length > 0) {
    throw new Error(`Could not access any of the ${description} sources. Check permissions or connectivity.`);
  }

  return allQuads;
}

async function loadTtlWithSession(url: string, session: Session): Promise<Quad[]> {
  try {
    const response = await session.fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    
    const text = await response.text();
    const parser = new Parser();
    return parser.parse(text);
  } catch (error) {
    console.error(`Error loading Turtle from ${url}:`, error);
    throw error;
  }
}

export async function fetchAndParseData(session: Session) {
  // Define multiple potential sources for each data type
  const buildingSources = [
    "https://solid.ti.rw.fau.de/private/granergize/buildings.ttl",
    "https://granergize-homer.solidcommunity.net/public/buildings.ttl"
  ];

  const agentSources = [
    "https://solid.ti.rw.fau.de/private/granergize/agents.ttl",
  ];

  // Load and merge data from all accessible sources
  const buildingsQuads = await loadTtlFromMultipleSources(
    buildingSources,
    session,
    "buildings"
  );

  const agentsQuads = await loadTtlFromMultipleSources(
    agentSources,
    session,
    "agents"
  );

  // Parse the merged quad collections
  const buildings = parseBuildings(buildingsQuads);
  const agents = parseAgents(agentsQuads);
  const energyData = new Map<number, EnergyType>();

  // Object to store aggregated values for each measurement
  const aggregatedValues: Record<string, number[]> = {};
  const agentAggregatedValues: Record<string, Record<string, number[]>> = {};

  // Load energy data for each building
  for (const [buildingId, building] of buildings) {
    if (!building.energyData) {
      continue;
    }

    for (const data of building.energyData) {
      try {
        // For each building's energy data, try primary and alternative sources
        const energyDataSources = [
          data.location
        ];
        
        const energyQuads = await loadTtlFromMultipleSources(
          energyDataSources,
          session,
          `energy data for building ${buildingId}`
        );
        
        const uri = energyQuads[0].graph.value;
        const parsedEnergyData = parseEnergyData(buildingId, uri, energyQuads);
        energyData.set(parseInt(buildingId), parsedEnergyData);

        // Aggregate values for each measurement
        for (const category in parsedEnergyData) {
          const categoryData = parsedEnergyData[category as keyof EnergyType] as Record<string, number>;
          for (const property in categoryData) {
            if (!aggregatedValues[property]) {
              aggregatedValues[property] = [];
            }
            aggregatedValues[property].push(categoryData[property]);

            // Aggregate values by agent
            const agent = building.operatedBy;
            if (!agent) {
              continue;
            }
            if (!agentAggregatedValues[agent]) {
              agentAggregatedValues[agent] = {};
            }
            if (!agentAggregatedValues[agent][property]) {
              agentAggregatedValues[agent][property] = [];
            }
            agentAggregatedValues[agent][property].push(categoryData[property]);
          }
        }
      } catch (error: unknown) {
        console.error(`Failed to load energy data for building ${buildingId}:`, error);
        // Continue processing other buildings instead of throwing
      }
    }
  }

  // Calculate averages
  const averages: Record<string, number> = {};
  for (const property in aggregatedValues) {
    const values = aggregatedValues[property];
    const sum = values.reduce((acc, val) => acc + val, 0);
    averages[property] = sum / values.length;
  }

  // Calculate averages by agent
  const agentAverages: Record<string, Record<string, number>> = {};
  for (const agent in agentAggregatedValues) {
    agentAverages[agent] = {};
    for (const property in agentAggregatedValues[agent]) {
      const values = agentAggregatedValues[agent][property];
      const sum = values.reduce((acc, val) => acc + val, 0);
      agentAverages[agent][property] = sum / values.length;
    }
  }

  return {
    buildings: Array.from(buildings.values()),
    agents: Array.from(agents.values()),
    energyNeed: Array.from(energyData.values()),
    averages,
    agentAverages,
  };
}

export async function parseEnergyMix(session: Session) {
  const energyConsumptionQuads = await loadTtlWithSession(
    "https://solid.ti.rw.fau.de/private/granergize/data/2023/districtsEnergyConsumption.ttl",
    session
  );
  
  const energyProductionQuads = await loadTtlWithSession(
    "https://solid.ti.rw.fau.de/private/granergize/data/2023/districtsEnergyProduction.ttl",
    session
  );

  const energyConsumption = {} as Record<string, {value: number, renewableEnergyShare: number}>;
  const energyProduction = {} as Record<string, {hydroShare: number, windShare: number, solarShare: number, biomassShare: number, geothermalShare: number, hydroProduction: number, windProduction: number, solarProduction: number, biomassProduction: number, geothermalProduction: number, totalRenewableProduction: number}>;

  const consumptionStore = new Store();
  consumptionStore.addAll(energyConsumptionQuads);
  const consumptionQuads = consumptionStore.match(null, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#electricityConsumption'), null);
  consumptionQuads.forEach((quad: Quad) => {
    const cityUrl = quad.subject.value;
    const cityId = cityUrl.substring(cityUrl.lastIndexOf('/') + 1);
    const value = parseFloat(consumptionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#value'), null).toArray()[0].object.value);
    const renewableEnergyShare = parseFloat(consumptionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#renewableEnergyShare'), null).toArray()[0].object.value);
    energyConsumption[cityId] = {value, renewableEnergyShare};
  });

  const productionStore = new Store();
  productionStore.addAll(energyProductionQuads);
  const productionQuads = productionStore.match(null, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#renewableEnergyProduction'), null);
  productionQuads.forEach((quad: Quad) => {
    const cityUrl = quad.subject.value;
    const cityId = cityUrl.substring(cityUrl.lastIndexOf('/') + 1);
    const hydroShare = parseFloat(productionStore. match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hydroShare'), null).toArray()[0].object.value);
    const windShare = parseFloat(productionStore.match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#windShare'), null).toArray()[0].object.value);
    const solarShare = parseFloat(productionStore. match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#solarShare'), null).toArray()[0].object.value);
    const biomassShare = parseFloat(productionStore. match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#biomassShare'), null).toArray()[0].object.value);
    const geothermalShare = parseFloat(productionStore. match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#geothermalShare'), null).toArray()[0].object.value);
    const hydroProduction = parseFloat(productionStore. match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hydroProduction'), null).toArray()[0].object.value);
    const windProduction = parseFloat(productionStore. match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#windProduction'), null).toArray()[0].object.value);
    const solarProduction = parseFloat(productionStore. match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#solarProduction'), null).toArray()[0].object.value);
    const biomassProduction = parseFloat(productionStore. match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#biomassProduction'), null).toArray()[0].object.value);
    const geothermalProduction = parseFloat(productionStore. match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#geothermalProduction'), null).toArray()[0].object.value);
    const totalRenewableProduction = parseFloat(productionStore. match(quad.object as Term, namedNode('https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#totalRenewableProduction'), null).toArray()[0].object.value);
    energyProduction[cityId] = {hydroShare, windShare, solarShare, biomassShare, geothermalShare, hydroProduction, windProduction, solarProduction, biomassProduction, geothermalProduction, totalRenewableProduction};
  });

  return {
    energyConsumption: energyConsumption,
    energyProduction: energyProduction,
  };
}
import { Session } from "@inrupt/solid-client-authn-browser";
import { parseBuildings } from "./utils/buildingParser.ts";
import { parseAgents } from "./utils/agentParser.ts";
import { parseEnergyData } from "./utils/energyDataParser.ts";
import type { BuildingType, EnergyType } from "../../types/types.ts";
import { DataFactory, Parser, Store, Term, Writer } from "n3";
import type { Quad } from "@rdfjs/types";
import { getStorageRoot, getPodBaseUrl } from "./utils/solidUtils.ts";

const { namedNode } = DataFactory;

/**
 * Attempts to load Turtle data from multiple sources, continuing if some fail
 */
async function loadTtlFromMultipleSources(
  urls: string[],
  session: Session,
  description: string,
): Promise<{ quads: Quad[]; failedSources: Array<{ url: string; status: number }> }> {
  const allQuads: Quad[] = [];
  const successfulSources: string[] = [];
  const failedSources: { url: string; error: string; status?: number }[] = [];

  // Try each source independently
  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await session.fetch(url);
        if (!response.ok) {
          failedSources.push({
            url,
            error: `HTTP ${response.status}: ${response.statusText}`,
            status: response.status,
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
            DataFactory.namedNode(url),
          );
        });

        // Add these quads to our collection
        allQuads.push(...quadsWithGraph);
        successfulSources.push(url);
      } catch (error) {
        failedSources.push({
          url,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );

  // Log results
  if (successfulSources.length > 0) {
    console.log(
      `Successfully loaded ${description} from ${successfulSources.length} sources:`,
      successfulSources,
    );
  }

  if (failedSources.length > 0) {
    console.warn(
      `Failed to load ${description} from ${failedSources.length} sources:`,
      failedSources,
    );
  }

  if (allQuads.length === 0 && urls.length > 0) {
    throw new Error(
      `Could not access any of the ${description} sources. Check permissions or connectivity.`,
    );
  }

  return {
    quads: allQuads,
    failedSources: failedSources
      .filter(f => f.status === 403 || f.status === 404)
      .map(f => ({ url: f.url, status: f.status! }))
  };
}

async function loadTtlWithSession(
  url: string,
  session: Session,
): Promise<Quad[]> {
  try {
    const response = await session.fetch(url);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      );
    }

    const text = await response.text();
    const parser = new Parser();
    return parser.parse(text);
  } catch (error) {
    console.error(`Error loading Turtle from ${url}:`, error);
    throw error;
  }
}

/**
 * Remove inaccessible building sources from the user's dataSources.ttl
 */
async function removeInaccessibleBuildingSources(
  failedSources: Array<{ url: string; status: number }>,
  session: Session
): Promise<void> {
  const webId = session.info.webId;
  if (!webId) {
    return;
  }

  const podBaseUrl = getPodBaseUrl(webId);
  const registryUrl = `${podBaseUrl}granergize/dataSources.ttl`;

  try {
    const response = await session.fetch(registryUrl);
    if (!response.ok) {
      return;
    }

    const text = await response.text();
    const parser = new Parser({ format: "text/turtle", baseIRI: registryUrl });
    const quads = parser.parse(text);
    const store = new Store(quads);

    const buildingSourcePredicate = namedNode(
      "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasBuildingDataSource"
    );
    const registryNode = namedNode(registryUrl);

    // Remove quads for failed sources
    let removed = false;
    for (const failed of failedSources) {
      const sourceNode = namedNode(failed.url);
      const quadsToRemove = store.getQuads(registryNode, buildingSourcePredicate, sourceNode, null);
      if (quadsToRemove.length > 0) {
        quadsToRemove.forEach(quad => store.removeQuad(quad));
        removed = true;
        console.log(`Removed inaccessible building source: ${failed.url}`);
      }
    }

    // Only update if we removed something
    if (removed) {
      const writer = new Writer({ format: "text/turtle" });
      const updatedTtl = writer.quadsToString(store.getQuads(null, null, null, null));

      await session.fetch(registryUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/turtle" },
        body: updatedTtl,
      });

      console.log("Updated dataSources.ttl to remove inaccessible sources");
    }
  } catch (error) {
    console.error("Error removing inaccessible building sources:", error);
  }
}

async function getSourceRegistry(
  session: Session,
): Promise<{ agents: string[]; buildings: string[] }> {
  const webId = session.info.webId;
  if (!webId) {
    throw new Error("No WebID found in session.");
  }

  const podBaseUrl = getPodBaseUrl(webId);
  const registryUrl = `${podBaseUrl}granergize/dataSources.ttl`;

  try {
    const response = await session.fetch(registryUrl+ "?t=" + Date.now());
    if (!response.ok) {
      session.fetch(registryUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "text/turtle",
        },
        // fill with default values
        body: `@prefix dcterms: <http://purl.org/dc/terms/> .
          @prefix gran: <https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#> .

          <${registryUrl}> a gran:DataSourceRegistry ;
            dcterms:creator <${webId}> ;
            gran:hasBuildingDataSource <https://solid.ti.rw.fau.de/private/granergize/buildings.ttl> ;
            gran:hasAgentDataSource <https://solid.ti.rw.fau.de/private/granergize/agents.ttl> .`,
      }).then((res) => {
        if (!res.ok) {
          console.error(
            `Failed to create data source registry at ${registryUrl}: ${res.status} ${res.statusText}`,
          );
        } else {
          console.log(`Created new data source registry at ${registryUrl}`);
        }
      });
    }

    const text = await response.text();
    const parser = new Parser({ baseIRI: registryUrl });
    const quads = parser.parse(text);
    const store = new Store(quads);

    const buildingSources: string[] = [];
    const agentSources: string[] = [];

    const buildingQuads = store.getQuads(
      namedNode(registryUrl),
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasBuildingDataSource",
      ),
      null,
      null,
    );

    buildingQuads.forEach((quad) => {
      if (quad.object.termType === "NamedNode") {
        buildingSources.push(quad.object.value);
      }
    });

    const agentQuads = store.getQuads(
      namedNode(registryUrl),
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasAgentDataSource",
      ),
      null,
      null,
    );

    agentQuads.forEach((quad) => {
      if (quad.object.termType === "NamedNode") {
        agentSources.push(quad.object.value);
      }
    });

    return {
      buildings: buildingSources,
      agents: agentSources,
    };
  } catch (error) {
    console.error("Error loading data source registry:", error);

    return {
      buildings: [],
      agents: [],
    };
  }
}

/**
 * Load list of hidden building URIs from the user's hidden buildings file
 */
async function getHiddenBuildings(session: Session): Promise<Set<string>> {
  const webId = session.info.webId;
  if (!webId) {
    return new Set();
  }

  // Extract storage root
  const storageRoot = getStorageRoot(webId);
  const hiddenBuildingsUrl = `${storageRoot}granergize/hiddenBuildings.ttl`;

  try {
    const response = await session.fetch(hiddenBuildingsUrl);
    
    if (response.status === 404) {
      return new Set();
    }
    
    if (!response.ok) {
      console.warn(`Failed to fetch hidden buildings: ${response.statusText}`);
      return new Set();
    }
    
    const text = await response.text();
    const parser = new Parser({ format: "text/turtle", baseIRI: hiddenBuildingsUrl });
    const quads = parser.parse(text);
    const store = new Store(quads);

    const hiddenPredicate = DataFactory.namedNode(
      "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hiddenBuilding"
    );
    
    const hiddenQuads = store.getQuads(null, hiddenPredicate, null, null);
    const hiddenSet = new Set<string>();

    for (const quad of hiddenQuads) {
      if (quad.object.termType === "NamedNode") {
        hiddenSet.add(quad.object.value);
      }
    }

    return hiddenSet;
  } catch (error) {
    console.error("Error loading hidden buildings:", error);
    return new Set();
  }
}

export async function fetchAndParseData(session: Session) {
  // get own solid pod url
  const webId = session.info.webId;
  if (!webId) {
    throw new Error("No WebID found in session.");
  }

  const dataSources = await getSourceRegistry(session);

  // Load hidden buildings list
  const hiddenBuildingUris = await getHiddenBuildings(session);

  // Load and merge data from all accessible sources
  const buildingsResult = await loadTtlFromMultipleSources(
    dataSources.buildings,
    session,
    "buildings",
  );

  const agentsResult = await loadTtlFromMultipleSources(
    dataSources.agents,
    session,
    "agents",
  );

  // Remove inaccessible building sources from registry (403/404 errors)
  if (buildingsResult.failedSources.length > 0) {
    await removeInaccessibleBuildingSources(buildingsResult.failedSources, session);
  }

  // Parse the merged quad collections
  const buildings = parseBuildings(buildingsResult.quads);
  const agents = parseAgents(agentsResult.quads);
  const energyData = new Map<number, EnergyType>();

  // Determine user's storage root to identify shared buildings
  const storageRoot = getStorageRoot(webId);

  // Filter out hidden buildings and mark shared buildings
  const visibleBuildings = new Map<string, BuildingType>();
  for (const [buildingId, building] of buildings) {
    if (!hiddenBuildingUris.has(building.uri)) {
      // Check if building is from external source (shared with user)
      const isOwnBuilding = building.uri.startsWith(storageRoot);
      const isPublicResource = building.uri.includes("/private/granergize/");
      building.isShared = !isOwnBuilding && !isPublicResource;
      
      visibleBuildings.set(buildingId, building);
    }
  }

  // Object to store aggregated values for each measurement
  const aggregatedValues: Record<string, number[]> = {};
  const agentAggregatedValues: Record<string, Record<string, number[]>> = {};

  // Load energy data for each building (only visible ones)
  for (const [buildingId, building] of visibleBuildings) {
    if (!building.energyData) {
      continue;
    }

    for (const data of building.energyData) {
      try {
        // For each building's energy data, try primary and alternative sources
        const energyDataSources = [
          data.location,
        ];

        const energyResult = await loadTtlFromMultipleSources(
          energyDataSources,
          session,
          `energy data for building ${buildingId}`,
        );

        const uri = energyResult.quads[0].graph.value;
        const parsedEnergyData = parseEnergyData(buildingId, uri, energyResult.quads);
        energyData.set(parseInt(buildingId), parsedEnergyData);

        // Aggregate values for each measurement
        for (const category in parsedEnergyData) {
          const categoryData =
            parsedEnergyData[category as keyof EnergyType] as Record<
              string,
              number
            >;
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
        console.error(
          `Failed to load energy data for building ${buildingId}:`,
          error,
        );
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
    buildings: Array.from(visibleBuildings.values()),
    agents: Array.from(agents.values()),
    energyNeed: Array.from(energyData.values()),
    averages,
    agentAverages,
  };
}

export async function parseEnergyMix(session: Session) {
  const energyConsumptionQuads = await loadTtlWithSession(
    "https://solid.ti.rw.fau.de/private/granergize/data/energy/2023/districtsEnergyConsumption.ttl",
    session,
  );

  const energyProductionQuads = await loadTtlWithSession(
    "https://solid.ti.rw.fau.de/private/granergize/data/energy/2023/districtsEnergyProduction.ttl",
    session,
  );

  const energyConsumption = {} as Record<
    string,
    { value: number; renewableEnergyShare: number }
  >;
  const energyProduction = {} as Record<
    string,
    {
      hydroShare: number;
      windShare: number;
      solarShare: number;
      biomassShare: number;
      geothermalShare: number;
      hydroProduction: number;
      windProduction: number;
      solarProduction: number;
      biomassProduction: number;
      geothermalProduction: number;
      totalRenewableProduction: number;
    }
  >;

  const consumptionStore = new Store();
  consumptionStore.addAll(energyConsumptionQuads);
  const consumptionQuads = consumptionStore.match(
    null,
    namedNode(
      "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#electricityConsumption",
    ),
    null,
  );
  consumptionQuads.forEach((quad: Quad) => {
    const cityUrl = quad.subject.value;
    const cityId = cityUrl.substring(cityUrl.lastIndexOf("/") + 1);
    const value = parseFloat(
      consumptionStore.match(
        quad.object as Term,
        namedNode(
          "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#value",
        ),
        null,
      ).toArray()[0].object.value,
    );
    const renewableEnergyShare = parseFloat(
      consumptionStore.match(
        quad.object as Term,
        namedNode(
          "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#renewableEnergyShare",
        ),
        null,
      ).toArray()[0].object.value,
    );
    energyConsumption[cityId] = { value, renewableEnergyShare };
  });

  const productionStore = new Store();
  productionStore.addAll(energyProductionQuads);
  const productionQuads = productionStore.match(
    null,
    namedNode(
      "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#renewableEnergyProduction",
    ),
    null,
  );
  productionQuads.forEach((quad: Quad) => {
    const cityUrl = quad.subject.value;
    const cityId = cityUrl.substring(cityUrl.lastIndexOf("/") + 1);
    const hydroShare = parseFloat(
      productionStore.match(
        quad.object as Term,
        namedNode(
          "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hydroShare",
        ),
        null,
      ).toArray()[0].object.value,
    );
    const windShare = parseFloat(
      productionStore.match(
        quad.object as Term,
        namedNode(
          "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#windShare",
        ),
        null,
      ).toArray()[0].object.value,
    );
    const solarShare = parseFloat(
      productionStore.match(
        quad.object as Term,
        namedNode(
          "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#solarShare",
        ),
        null,
      ).toArray()[0].object.value,
    );
    const biomassShare = parseFloat(
      productionStore.match(
        quad.object as Term,
        namedNode(
          "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#biomassShare",
        ),
        null,
      ).toArray()[0].object.value,
    );
    const geothermalShare = parseFloat(
      productionStore.match(
        quad.object as Term,
        namedNode(
          "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#geothermalShare",
        ),
        null,
      ).toArray()[0].object.value,
    );
    const hydroProduction = parseFloat(
      productionStore.match(
        quad.object as Term,
        namedNode(
          "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hydroProduction",
        ),
        null,
      ).toArray()[0].object.value,
    );
    const windProduction = parseFloat(
      productionStore.match(
        quad.object as Term,
        namedNode(
          "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#windProduction",
        ),
        null,
      ).toArray()[0].object.value,
    );
    const solarProduction = parseFloat(
      productionStore.match(
        quad.object as Term,
        namedNode(
          "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#solarProduction",
        ),
        null,
      ).toArray()[0].object.value,
    );
    const biomassProduction = parseFloat(
      productionStore.match(
        quad.object as Term,
        namedNode(
          "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#biomassProduction",
        ),
        null,
      ).toArray()[0].object.value,
    );
    const geothermalProduction = parseFloat(
      productionStore.match(
        quad.object as Term,
        namedNode(
          "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#geothermalProduction",
        ),
        null,
      ).toArray()[0].object.value,
    );
    const totalRenewableProduction = parseFloat(
      productionStore.match(
        quad.object as Term,
        namedNode(
          "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#totalRenewableProduction",
        ),
        null,
      ).toArray()[0].object.value,
    );
    energyProduction[cityId] = {
      hydroShare,
      windShare,
      solarShare,
      biomassShare,
      geothermalShare,
      hydroProduction,
      windProduction,
      solarProduction,
      biomassProduction,
      geothermalProduction,
      totalRenewableProduction,
    };
  });

  return {
    energyConsumption: energyConsumption,
    energyProduction: energyProduction,
  };
}

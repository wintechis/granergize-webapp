import { Session } from "@inrupt/solid-client-authn-browser";
import { parseBuildings } from "./utils/buildingParser.ts";
import { parseAgents } from "./utils/agentParser.ts";
import { parseEnergyData } from "./utils/energyDataParser.ts";
import type {
  BuildingType,
  EnergyType,
  InvestorAnnualData,
  UserRole,
} from "../../types/types.ts";
import { DataFactory, Parser, Store, Term, Writer } from "n3";
import type { Quad } from "@rdfjs/types";
import { getPodBaseUrl, getStorageRoot } from "./utils/solidUtils.ts";
import { GRAN_NS } from "./utils/vocabularies.ts";

const { namedNode } = DataFactory;

/** Maps gran: role IRIs back to TypeScript UserRole values */
const IRI_TO_ROLE: Record<string, UserRole> = {
  [`${GRAN_NS}DummyRole`]: "dummy",
  [`${GRAN_NS}InvestorRole`]: "investor",
  [`${GRAN_NS}UserRoleInstance`]: "user",
  [`${GRAN_NS}BenchmarkRole`]: "benchmark_service_provider",
};

/**
 * Attempts to load Turtle data from multiple sources, continuing if some fail
 */
async function loadTtlFromMultipleSources(
  urls: string[],
  session: Session,
  description: string,
): Promise<
  { quads: Quad[]; failedSources: Array<{ url: string; status: number }> }
> {
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

        // Unique prefix for blank nodes from this source, to avoid ID collisions
        // when multiple files use the same generic blank node names (_:obs0_0, etc.)
        const bnPrefix = encodeURIComponent(url) + "__";
        const scopedNode = (term: Quad["subject"]): Quad["subject"] => {
          if (term.termType === "BlankNode") {
            return DataFactory.blankNode(bnPrefix + term.value);
          }
          return term;
        };

        // Add source information to each quad
        const quadsWithGraph = quads.map((quad: Quad) => {
          // Create a new quad with the source URL as the graph and scoped blank nodes
          return DataFactory.quad(
            scopedNode(quad.subject) as Quad["subject"],
            quad.predicate,
            scopedNode(quad.object as Quad["subject"]) as Quad["object"],
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
      .filter((f) => f.status === 403 || f.status === 404)
      .map((f) => ({ url: f.url, status: f.status! })),
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
  session: Session,
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
      `${GRAN_NS}hasBuildingDataSource`,
    );
    const registryNode = namedNode(registryUrl);

    // Remove quads for failed sources
    const dataSourceRolePredicate = namedNode(`${GRAN_NS}dataSourceRole`);
    let removed = false;
    for (const failed of failedSources) {
      const sourceNode = namedNode(failed.url);
      const quadsToRemove = store.getQuads(
        registryNode,
        buildingSourcePredicate,
        sourceNode,
        null,
      );
      if (quadsToRemove.length > 0) {
        quadsToRemove.forEach((q) =>
          store.removeQuad(q as Parameters<typeof store.removeQuad>[0])
        );
        // Also remove the role annotation for this building URL
        const roleQuads = store.getQuads(
          sourceNode,
          dataSourceRolePredicate,
          null,
          null,
        );
        roleQuads.forEach((q) =>
          store.removeQuad(q as Parameters<typeof store.removeQuad>[0])
        );
        removed = true;
        console.log(`Removed inaccessible building source: ${failed.url}`);
      }
    }

    // Only update if we removed something
    if (removed) {
      const writer = new Writer({ format: "text/turtle" });
      const updatedTtl = writer.quadsToString(
        store.getQuads(null, null, null, null),
      );

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
): Promise<
  { agents: string[]; buildings: Array<{ url: string; role: UserRole }> }
> {
  const webId = session.info.webId;
  if (!webId) {
    throw new Error("No WebID found in session.");
  }

  const podBaseUrl = getPodBaseUrl(webId);
  const registryUrl = `${podBaseUrl}granergize/dataSources.ttl`;

  try {
    const response = await session.fetch(registryUrl + "?t=" + Date.now());

    let registryText = "";
    if (!response.ok) {
      // Bootstrap default registry with the shared buildings annotated as DummyRole
      const defaultBody = `@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix gran: <${GRAN_NS}> .

<${registryUrl}> a gran:DataSourceRegistry ;
  dcterms:creator <${webId}> ;
  gran:hasBuildingDataSource <https://solid.ti.rw.fau.de/private/granergize/buildings.ttl> ;
  gran:hasAgentDataSource <https://solid.ti.rw.fau.de/private/granergize/agents.ttl> .

<https://solid.ti.rw.fau.de/private/granergize/buildings.ttl> gran:dataSourceRole gran:DummyRole .`;

      await session.fetch(registryUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/turtle" },
        body: defaultBody,
      }).then((res: Response) => {
        if (!res.ok) {
          console.error(
            `Failed to create data source registry at ${registryUrl}: ${res.status} ${res.statusText}`,
          );
        } else {
          console.log(`Created new data source registry at ${registryUrl}`);
        }
      });
      registryText = defaultBody;
    } else {
      registryText = await response.text();
    }

    const parser = new Parser({ baseIRI: registryUrl });
    const quads = parser.parse(registryText);
    const store = new Store(quads);

    const buildingSources: Array<{ url: string; role: UserRole }> = [];
    const agentSources: string[] = [];
    const registryNode = namedNode(registryUrl);
    const dataSourceRolePredicate = namedNode(`${GRAN_NS}dataSourceRole`);

    const buildingQuads = store.getQuads(
      registryNode,
      namedNode(`${GRAN_NS}hasBuildingDataSource`),
      null,
      null,
    );

    buildingQuads.forEach((quad: Quad) => {
      if (quad.object.termType === "NamedNode") {
        const url = quad.object.value;
        // Look up the role annotation for this building URL
        const roleQuads = store.getQuads(
          namedNode(url),
          dataSourceRolePredicate,
          null,
          null,
        );
        let role: UserRole = "dummy"; // default for backward compat
        if (
          roleQuads.length > 0 && roleQuads[0].object.termType === "NamedNode"
        ) {
          role = IRI_TO_ROLE[roleQuads[0].object.value] ?? "dummy";
        }
        buildingSources.push({ url, role });
      }
    });

    const agentQuads = store.getQuads(
      registryNode,
      namedNode(`${GRAN_NS}hasAgentDataSource`),
      null,
      null,
    );

    agentQuads.forEach((quad: Quad) => {
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
  const hiddenBuildingsUrl =
    `${storageRoot}profile/granergize/hiddenBuildings.ttl`;

  try {
    const response = await session.fetch(hiddenBuildingsUrl);

    if (response.status === 404) {
      // Create an empty hidden buildings file for future use
      await session.fetch(hiddenBuildingsUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/turtle" },
        body: "",
      });
      return new Set();
    }

    if (!response.ok) {
      console.warn(`Failed to fetch hidden buildings: ${response.statusText}`);
      return new Set();
    }

    const text = await response.text();
    const parser = new Parser({
      format: "text/turtle",
      baseIRI: hiddenBuildingsUrl,
    });
    const quads = parser.parse(text);
    const store = new Store(quads);

    const hiddenPredicate = DataFactory.namedNode(`${GRAN_NS}hiddenBuilding`);

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

  const roleFilteredBuildings = [
    ...new Set(dataSources.buildings.map((b) => b.url)),
  ];

  // Load hidden buildings list
  const hiddenBuildingUris = await getHiddenBuildings(session);

  // Load and merge data from all accessible sources
  const buildingsResult = await loadTtlFromMultipleSources(
    roleFilteredBuildings,
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
    await removeInaccessibleBuildingSources(
      buildingsResult.failedSources,
      session,
    );
  }

  // Parse the merged quad collections
  const buildings = parseBuildings(buildingsResult.quads);
  const agents = parseAgents(agentsResult.quads);
  const energyData = new Map<number, EnergyType>();

  // Determine user's storage root to identify shared buildings
  const storageRoot = getStorageRoot(webId);
  const sourceRoleMap = new Map(
    dataSources.buildings.map((b) => [b.url, b.role]),
  );

  // Filter out hidden buildings and mark shared buildings
  const visibleBuildings = new Map<string, BuildingType>();
  for (const [buildingId, building] of buildings) {
    if (!hiddenBuildingUris.has(building.uri.split("#")[0])) {
      // Check if building is from external source (shared with user)
      // Use sourceUri for ownership check (tracks where the file came from)
      const sourceForOwnershipCheck = building.sourceUri || building.uri;
      const isOwnBuilding = sourceForOwnershipCheck.startsWith(storageRoot);
      building.isShared = !isOwnBuilding;
      building.sourceRole = sourceRoleMap.get(building.sourceUri ?? "") ??
        "dummy";

      visibleBuildings.set(buildingId, building);
    }
  }

  // Object to store aggregated values for each measurement
  const aggregatedValues: Record<string, number[]> = {};
  const agentAggregatedValues: Record<string, Record<string, number[]>> = {};

  {
    // Load energy data for each building (only visible ones)
    // User-role buildings are skipped — their data is loaded on demand when clicked
    for (const [buildingId, building] of visibleBuildings) {
      if (building.sourceRole === "user") {
        continue;
      }
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
          const parsedEnergyData = parseEnergyData(
            buildingId,
            uri,
            energyResult.quads,
          );

          // Derive a stable numeric id matching buildingParser's logic
          const numericBuildingId = /^\d+$/.test(buildingId)
            ? parseInt(buildingId)
            : buildingId.split("").reduce(
              (h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0,
              0,
            ) >>> 0;
          parsedEnergyData.id = numericBuildingId;

          // User-role buildings produce one EnergyType entry per daily file;
          // merge all timeSeries arrays instead of overwriting the entry.
          if (parsedEnergyData.timeSeries) {
            const existing = energyData.get(numericBuildingId);
            if (existing?.timeSeries) {
              existing.timeSeries.electricityConsumption.push(
                ...parsedEnergyData.timeSeries.electricityConsumption,
              );
            } else {
              energyData.set(numericBuildingId, parsedEnergyData);
            }
            // Skip categorical aggregation for time-series data
            continue;
          }

          energyData.set(numericBuildingId, parsedEnergyData);

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
              agentAggregatedValues[agent][property].push(
                categoryData[property],
              );
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
  }

  // For investor buildings: synthesize energyNeed entries from inline annualData
  // (investor buildings have no separate energy files; data is in SOSA observations)
  for (const [buildingId, building] of visibleBuildings) {
    if (building.sourceRole !== "investor") continue;
    const numericBuildingId = /^\d+$/.test(buildingId)
      ? parseInt(buildingId)
      : buildingId.split("").reduce(
        (h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0,
        0,
      ) >>> 0;
    if (energyData.has(numericBuildingId)) continue;
    const annualData = building.annualData as InvestorAnnualData[] | undefined;
    if (!annualData || annualData.length === 0) continue;
    const latest = annualData.reduce((a, b) => a.year > b.year ? a : b);
    const energyNeedEntry: Record<string, number> = {};
    if (latest.electricityConsumption !== undefined) {
      energyNeedEntry["Electricity"] = latest.electricityConsumption;
    }
    if (latest.heatConsumption !== undefined) {
      energyNeedEntry["Heat"] = latest.heatConsumption;
    }
    if (latest.waterConsumption !== undefined) {
      energyNeedEntry["Water"] = latest.waterConsumption;
    }
    if (latest.wastewaterConsumption !== undefined) {
      energyNeedEntry["Wastewater"] = latest.wastewaterConsumption;
    }
    if (Object.keys(energyNeedEntry).length === 0) continue;
    energyData.set(numericBuildingId, {
      id: numericBuildingId,
      uri: building.uri as string,
      energyNeed: energyNeedEntry,
      energyGeneration: {},
      energyStorage: {},
      energyDistribution: {},
      energyTransfer: {},
      energyUsage: {},
      environmentalFactor: {},
    });
    // Include in aggregate averages
    for (const [prop, val] of Object.entries(energyNeedEntry)) {
      if (!aggregatedValues[prop]) aggregatedValues[prop] = [];
      aggregatedValues[prop].push(val);
      const agent = building.operatedBy;
      if (agent) {
        if (!agentAggregatedValues[agent]) agentAggregatedValues[agent] = {};
        if (!agentAggregatedValues[agent][prop]) {
          agentAggregatedValues[agent][prop] = [];
        }
        agentAggregatedValues[agent][prop].push(val);
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

function getQuadFloat(store: Store, subject: Term, predicate: Term): number {
  const quads = store.match(subject, predicate, null).toArray();
  return quads.length > 0 ? parseFloat(quads[0].object.value) : NaN;
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
    const value = getQuadFloat(
      consumptionStore,
      quad.object as Term,
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#value",
      ),
    );
    const renewableEnergyShare = getQuadFloat(
      consumptionStore,
      quad.object as Term,
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#renewableEnergyShare",
      ),
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
    const hydroShare = getQuadFloat(
      productionStore,
      quad.object as Term,
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hydroShare",
      ),
    );
    const windShare = getQuadFloat(
      productionStore,
      quad.object as Term,
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#windShare",
      ),
    );
    const solarShare = getQuadFloat(
      productionStore,
      quad.object as Term,
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#solarShare",
      ),
    );
    const biomassShare = getQuadFloat(
      productionStore,
      quad.object as Term,
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#biomassShare",
      ),
    );
    const geothermalShare = getQuadFloat(
      productionStore,
      quad.object as Term,
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#geothermalShare",
      ),
    );
    const hydroProduction = getQuadFloat(
      productionStore,
      quad.object as Term,
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hydroProduction",
      ),
    );
    const windProduction = getQuadFloat(
      productionStore,
      quad.object as Term,
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#windProduction",
      ),
    );
    const solarProduction = getQuadFloat(
      productionStore,
      quad.object as Term,
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#solarProduction",
      ),
    );
    const biomassProduction = getQuadFloat(
      productionStore,
      quad.object as Term,
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#biomassProduction",
      ),
    );
    const geothermalProduction = getQuadFloat(
      productionStore,
      quad.object as Term,
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#geothermalProduction",
      ),
    );
    const totalRenewableProduction = getQuadFloat(
      productionStore,
      quad.object as Term,
      namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#totalRenewableProduction",
      ),
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

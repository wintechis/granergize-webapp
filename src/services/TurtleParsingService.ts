import { Session } from "@inrupt/solid-client-authn-browser";
import { parseBuildings } from "./utils/buildingParser.ts";
import { parseAgents } from "./utils/agentParser.ts";
import { parseEnergyData } from "./utils/energyDataParser.ts";
import type {
  AgentType,
  BuildingType,
  EnergyType,
  InvestorAnnualData,
  UserRole,
} from "../../types/types.ts";
import { DataFactory, Parser, Store, Writer } from "n3";
import type { Quad } from "@rdfjs/types";
import { getPodBaseUrl, getStorageRoot } from "./utils/solidUtils.ts";
import { fetchFresh } from "./utils/podFetch.ts";
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
    const response = await fetchFresh(registryUrl, session);
    if (!response.ok) {
      return;
    }

    const text = await response.text();
    const parser = new Parser({ format: "text/turtle", baseIRI: registryUrl });
    const quads = parser.parse(text);
    const store = new Store(quads);

    const buildingSourcePredicate = namedNode(
      `${GRAN_NS}hasBuildingDataSource`,
    )
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
    const dataSourceRolePredicate = namedNode(`${GRAN_NS}dataSourceRole`);

    const buildingQuads = store.getQuads(
      null,
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
      null,
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
    const response = await fetchFresh(hiddenBuildingsUrl, session);

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

export async function fetchAndParseData(
  session: Session,
  /**
   * Called once buildings and agents are parsed, before the (slower) energy
   * files are fetched. Lets the caller render the map immediately while energy
   * data streams in. The building objects passed here are final — the energy
   * phase only populates energyData/averages, it never mutates buildings.
   */
  onBuildingsAndAgents?: (
    partial: { buildings: BuildingType[]; agents: AgentType[] },
  ) => void,
) {
  // get own solid pod url
  const webId = session.info.webId;
  if (!webId) {
    throw new Error("No WebID found in session.");
  }

  const dataSources = await getSourceRegistry(session);

  const roleFilteredBuildings = [
    ...new Set(dataSources.buildings.map((b) => b.url)),
  ];

  // The hidden-buildings list, the building sources, and the agent sources are
  // independent of one another, so fetch them concurrently rather than in
  // series.
  const [hiddenBuildingUris, buildingsResult, agentsResult] = await Promise.all([
    getHiddenBuildings(session),
    loadTtlFromMultipleSources(roleFilteredBuildings, session, "buildings"),
    loadTtlFromMultipleSources(dataSources.agents, session, "agents"),
  ]);

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

  // Phase 1 done: buildings and agents are fully parsed. Hand them to the
  // caller now so the map can paint while the energy files load below.
  onBuildingsAndAgents?.({
    buildings: Array.from(visibleBuildings.values()),
    agents: Array.from(agents.values()),
  });

  // Object to store aggregated values for each measurement
  const aggregatedValues: Record<string, number[]> = {};
  const agentAggregatedValues: Record<string, Record<string, number[]>> = {};

  {
    // Load energy data for each visible building. User-role buildings are
    // skipped (their data is loaded on demand when clicked); investor buildings
    // are synthesized below from inline observations.
    //
    // The per-file fetches are independent, so collect them first and run them
    // concurrently — doing one Pod round-trip per building in series was what
    // made the initial load (and therefore the map) take so long. Results are
    // accumulated afterwards in a plain CPU loop, preserving the prior order.
    const energyTasks: Array<
      { buildingId: string; building: BuildingType; location: string }
    > = [];
    for (const [buildingId, building] of visibleBuildings) {
      if (building.sourceRole === "user" || !building.energyData) {
        continue;
      }
      for (const data of building.energyData) {
        energyTasks.push({ buildingId, building, location: data.location });
      }
    }

    const parsedEnergyResults = await Promise.all(
      energyTasks.map(async ({ buildingId, location }) => {
        try {
          const energyResult = await loadTtlFromMultipleSources(
            [location],
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
          parsedEnergyData.id = /^\d+$/.test(buildingId)
            ? parseInt(buildingId)
            : buildingId.split("").reduce(
              (h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0,
              0,
            ) >>> 0;
          return parsedEnergyData;
        } catch (error: unknown) {
          console.error(
            `Failed to load energy data for building ${buildingId}:`,
            error,
          );
          // Skip this building instead of failing the whole load.
          return null;
        }
      }),
    );

    for (let i = 0; i < parsedEnergyResults.length; i++) {
      const parsedEnergyData = parsedEnergyResults[i];
      if (!parsedEnergyData) {
        continue;
      }
      const { building } = energyTasks[i];
      const numericBuildingId = parsedEnergyData.id;

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

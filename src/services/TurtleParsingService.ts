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
import { getStorageRoot, podResources, registryUrl } from "./utils/solidUtils.ts";
import { fetchFresh } from "./utils/podFetch.ts";
import { GRAN_NS } from "./utils/vocabularies.ts";
import { seedDemoBuildings } from "./utils/buildingSerializer.ts";
import { isSeriesGranularity } from "./utils/durationUtils.ts";

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
/**
 * Thrown when Pod reads fail with HTTP 401 — the auth token has (almost
 * certainly) expired. Callers should keep any previously loaded data and prompt
 * the user to log in again, rather than treat it as "no data".
 */
export class SessionExpiredError extends Error {
  constructor(message = "Session expired — please log in again.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

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

  // Try each source independently. fetchFresh revalidates (cache: "no-cache"),
  // so an unchanged document comes back as a cheap 304 instead of a full body.
  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetchFresh(url, session);
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
    // All sources unreadable. A 401 means the token expired — distinguish it so
    // the caller can keep prior data and prompt re-login instead of blanking out.
    if (failedSources.some((f) => f.status === 401)) {
      throw new SessionExpiredError(
        `Authentication failed loading ${description} (HTTP 401).`,
      );
    }
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

  const registry = registryUrl(webId);

  try {
    const response = await fetchFresh(registry, session);
    if (!response.ok) {
      return;
    }

    const text = await response.text();
    const parser = new Parser({ format: "text/turtle", baseIRI: registry });
    const quads = parser.parse(text);
    const store = new Store(quads);

    const buildingSourcePredicate = namedNode(
      `${GRAN_NS}hasBuildingDataSource`,
    )
    const registryNode = namedNode(registry);

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

      await session.fetch(registry, {
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

  const registry = registryUrl(webId);

  try {
    const response = await fetchFresh(registry, session);

    let registryText = "";
    if (!response.ok) {
      // First run: bootstrap an EMPTY registry (no external sources), then seed
      // two real, user-owned demo buildings so a fresh pod isn't blank. Seeding
      // runs only here — when the registry didn't exist — so deleting the demo
      // buildings doesn't resurrect them on the next load.
      const defaultBody = `@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix gran: <${GRAN_NS}> .

<${registry}> a gran:DataSourceRegistry ;
  dcterms:creator <${webId}> .`;

      const put = await session.fetch(registry, {
        method: "PUT",
        headers: { "Content-Type": "text/turtle" },
        body: defaultBody,
      });
      if (!put.ok) {
        console.error(
          `Failed to create data source registry at ${registry}: ${put.status} ${put.statusText}`,
        );
      } else {
        console.log(`Created new data source registry at ${registry}`);
        // Best-effort; seedDemoBuildings appends its own registry entries.
        await seedDemoBuildings(session, webId);
      }

      // Re-read so the freshly seeded building sources are included below.
      const seeded = await fetchFresh(registry, session);
      registryText = seeded.ok ? await seeded.text() : defaultBody;
    } else {
      registryText = await response.text();
    }

    const parser = new Parser({ baseIRI: registry });
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

  const hiddenBuildingsUrl = podResources(webId).hiddenBuildings;

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

/**
 * Phase 1: discover, fetch and parse the visible buildings + agents (no energy).
 * Fast enough to paint the map immediately; energy streams in via {@link loadEnergy}.
 */
export async function loadBuildingsAndAgents(
  session: Session,
): Promise<{ buildings: BuildingType[]; agents: AgentType[] }> {
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

  return {
    buildings: Array.from(visibleBuildings.values()),
    agents: Array.from(agents.values()),
  };
}

/**
 * Phase 2: load + parse energy for already-parsed buildings, returning the energy
 * series, category averages, and per-agent averages. A pure function of the
 * buildings it's given (their energy files + inline annualData) — no registry
 * re-read.
 */
export async function loadEnergy(
  session: Session,
  buildings: BuildingType[],
): Promise<{
  energyNeed: EnergyType[];
  averages: Record<string, number>;
  agentAverages: Record<string, Record<string, number>>;
}> {
  const energyData = new Map<number, EnergyType>();
  // Object to store aggregated values for each measurement
  const aggregatedValues: Record<string, number[]> = {};
  const agentAggregatedValues: Record<string, Record<string, number[]>> = {};

  {
    // Load energy data for each building. Sub-hourly *series* datasets are
    // skipped (loaded on demand when clicked); inline-aggregate buildings are
    // synthesized below from their annualData.
    //
    // The per-file fetches are independent, so collect them first and run them
    // concurrently — doing one Pod round-trip per building in series was what
    // made the initial load (and therefore the map) take so long. Results are
    // accumulated afterwards in a plain CPU loop, preserving the prior order.
    const energyTasks: Array<{ building: BuildingType; location: string }> = [];
    for (const building of buildings) {
      if (!building.energyData) continue;
      for (const data of building.energyData) {
        // Skip sub-hourly *series* datasets — they're large and loaded lazily on
        // click. Dispatch on the declared granularity, not the role; fall back to
        // the role default for legacy datasets that don't declare one.
        const isSeries = data.granularity
          ? isSeriesGranularity(data.granularity)
          : building.sourceRole === "user";
        if (isSeries) continue;
        energyTasks.push({ building, location: data.location });
      }
    }

    const parsedEnergyResults = await Promise.all(
      energyTasks.map(async ({ building, location }) => {
        try {
          const energyResult = await loadTtlFromMultipleSources(
            [location],
            session,
            `energy data for building ${building.id}`,
          );

          const uri = energyResult.quads[0].graph.value;
          const parsedEnergyData = parseEnergyData(
            String(building.id),
            uri,
            energyResult.quads,
          );

          // building.id is already buildingParser's stable numeric id.
          parsedEnergyData.id = building.id;
          return parsedEnergyData;
        } catch (error: unknown) {
          console.error(
            `Failed to load energy data for building ${building.id}:`,
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

  // Synthesize energyNeed entries from inline annualData for any building that
  // carries it (no separate energy file; the data is in inline SOSA observations).
  // Driven by the data shape (presence of annualData), not the provenance role —
  // investor and benchmark buildings both use this inline-aggregate shape.
  for (const building of buildings) {
    const inlineAnnual = building.annualData as
      | InvestorAnnualData[]
      | undefined;
    if (!inlineAnnual || inlineAnnual.length === 0) continue;
    const numericBuildingId = building.id;
    if (energyData.has(numericBuildingId)) continue;
    const latest = inlineAnnual.reduce((a, b) => a.year > b.year ? a : b);
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
    energyNeed: Array.from(energyData.values()),
    averages,
    agentAverages,
  };
}

/**
 * Back-compat orchestrator: phase 1 (buildings + agents) then phase 2 (energy),
 * with the same shape/two-phase callback as before. Used by the live harness and
 * the offline tests; the app drives the two phases as separate React Query
 * queries instead.
 */
export async function fetchAndParseData(
  session: Session,
  onBuildingsAndAgents?: (
    partial: { buildings: BuildingType[]; agents: AgentType[] },
  ) => void,
) {
  const { buildings, agents } = await loadBuildingsAndAgents(session);
  onBuildingsAndAgents?.({ buildings, agents });
  const energy = await loadEnergy(session, buildings);
  return { buildings, agents, ...energy };
}

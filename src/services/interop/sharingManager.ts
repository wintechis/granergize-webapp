import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store, Writer } from "n3";
import { getStorageRoot, getPodBaseUrl } from "../utils/solidUtils.ts";

interface SharedBuilding {
  buildingUri: string;
  buildingId: string;
  sharedWith: string[];
}

interface SharedWithMeBuilding {
  buildingUri: string;
  buildingId: string;
  sharedBy: string;
  isVisible: boolean;
  sharedRole?: string;
}

const GRAN_NS = "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#";
const IRI_TO_ROLE: Record<string, string> = {
  [`${GRAN_NS}DummyRole`]:     "dummy",
  [`${GRAN_NS}InvestorRole`]:  "investor",
  [`${GRAN_NS}UserRoleInstance`]: "user",
  [`${GRAN_NS}BenchmarkRole`]: "benchmark_service_provider",
};

/**
 * Get list of buildings the user has shared with others
 */
export async function getSharedBuildings(session: Session): Promise<SharedBuilding[]> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  const webId = session.info.webId;
  const podBaseUrl = getPodBaseUrl(webId);
  const sharingRegistryUrl = `${podBaseUrl}granergize/sharingRegistry.ttl`;

  try {
    const response = await session.fetch(sharingRegistryUrl);
    
    if (response.status === 404) {
      return [];
    }
    
    if (!response.ok) {
      throw new Error(`Failed to fetch sharing registry: ${response.statusText}`);
    }

    const text = await response.text();
    const parser = new Parser({ format: "text/turtle", baseIRI: sharingRegistryUrl });
    const quads = parser.parse(text);

    const buildingsMap = new Map<string, Set<string>>();

    // Parse sharing records
    const sharedWithPredicate = DataFactory.namedNode(
      "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#sharedWith"
    );

    quads.forEach((quad) => {
      if (quad.predicate.equals(sharedWithPredicate)) {
        const buildingUri = quad.subject.value;
        const webId = quad.object.value;

        if (!buildingsMap.has(buildingUri)) {
          buildingsMap.set(buildingUri, new Set());
        }
        buildingsMap.get(buildingUri)!.add(webId);
      }
    });

    return Array.from(buildingsMap.entries()).map(([buildingUri, webIds]) => ({
      buildingUri,
      buildingId: buildingUri.split("/").pop()?.replace(".ttl", "") || "",
      sharedWith: Array.from(webIds),
    }));
  } catch (error) {
    console.error("Error getting shared buildings:", error);
    return [];
  }
}

/**
 * Get list of buildings shared with the user
 */
export async function getSharedWithMe(session: Session): Promise<SharedWithMeBuilding[]> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  const webId = session.info.webId;
  const storageRoot = getStorageRoot(webId);
  
  const registryUrl = `${storageRoot}profile/granergize/dataSources.ttl`;
  const hiddenBuildingsUrl = `${storageRoot}profile/granergize/hiddenBuildings.ttl`;

  try {
    // Get list of hidden buildings
    const hiddenBuildings = await getHiddenBuildings(session, hiddenBuildingsUrl);

    // Load the data sources registry
    const response = await session.fetch(registryUrl);
    
    if (response.status === 404) {
      return [];
    }
    
    if (!response.ok) {
      throw new Error(`Failed to fetch data sources: ${response.statusText}`);
    }

    const text = await response.text();
    const parser = new Parser({ format: "text/turtle", baseIRI: registryUrl });
    const quads = parser.parse(text);
    const store = new Store(quads);

    const buildingSourcePredicate = DataFactory.namedNode(
      "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasBuildingDataSource"
    );
    const registryNode = DataFactory.namedNode(registryUrl);
    
    const buildingQuads = store.getQuads(registryNode, buildingSourcePredicate, null, null);

    const sharedBuildings: SharedWithMeBuilding[] = [];

    for (const quad of buildingQuads) {
      const buildingUri = quad.object.value;
      
      // Check if this building is from an external source (shared with me)
      const isOwnBuilding = buildingUri.startsWith(storageRoot);
      
      if (!isOwnBuilding) {
        // Extract building ID and owner
        const buildingId = buildingUri.split("/").pop()?.replace(".ttl", "") || "";
        const ownerMatch = buildingUri.match(/https?:\/\/[^/]+\/([^/]+)\//);
        const sharedBy = ownerMatch ? `${ownerMatch[0]}profile/card#me` : "Unknown";

        // Read the role annotation stored alongside the building data source
        const roleQuads = store.getQuads(
          DataFactory.namedNode(buildingUri),
          DataFactory.namedNode(`${GRAN_NS}dataSourceRole`),
          null,
          null,
        );
        const roleIri = roleQuads.length > 0 ? roleQuads[0].object.value : undefined;
        const sharedRole = roleIri ? IRI_TO_ROLE[roleIri] : undefined;

        sharedBuildings.push({
          buildingUri,
          buildingId,
          sharedBy,
          isVisible: !hiddenBuildings.has(buildingUri),
          sharedRole,
        });
      }
    }

    return sharedBuildings;
  } catch (error) {
    console.error("Error getting shared with me buildings:", error);
    return [];
  }
}

async function getHiddenBuildings(session: Session, hiddenBuildingsUrl: string): Promise<Set<string>> {
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
    
    const text = await response.text();
    const parser = new Parser({ format: "text/turtle", baseIRI: hiddenBuildingsUrl });
    const quads = parser.parse(text);
    
    const hiddenPredicate = DataFactory.namedNode(
      "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hiddenBuilding"
    );
    
    const hiddenBuildings = new Set<string>();
    quads.forEach((quad) => {
      if (quad.predicate.equals(hiddenPredicate)) {
        hiddenBuildings.add(quad.object.value);
      }
    });
    
    return hiddenBuildings;
  } catch (_error) {
    return new Set();
  }
}

/**
 * Revoke access to a building for a specific user
 */
export async function revokeAccess(
  buildingUri: string,
  webId: string,
  session: Session
): Promise<void> {
  if (!session.info.isLoggedIn) {
    throw new Error("User is not logged in");
  }

  // Remove from sharing registry
  await removeFromSharingRegistry(buildingUri, webId, session);

  // Remove from ACL
  await removeFromACL(buildingUri, webId, session);

  // If building has energy data, revoke that too
  try {
    const energyTargets = await getEnergyAclTargets(buildingUri, session);
    for (const target of energyTargets) {
      await removeFromACL(target, webId, session);
    }
  } catch (error) {
    console.warn("Could not revoke energy data access:", error);
  }

  // Notify the user that access has been revoked
  try {
    await notifyAccessRevoked(buildingUri, webId, session);
  } catch (error) {
    console.warn("Could not send revocation notification:", error);
    // Don't throw - revocation succeeded even if notification failed
  }
}

async function removeFromSharingRegistry(
  buildingUri: string,
  webId: string,
  session: Session
): Promise<void> {
  const userWebId = session.info.webId!;
  const podBaseUrl = getPodBaseUrl(userWebId);
  const sharingRegistryUrl = `${podBaseUrl}granergize/sharingRegistry.ttl`;

  const response = await session.fetch(sharingRegistryUrl);
  
  if (response.status === 404) {
    return;
  }

  const text = await response.text();
  const parser = new Parser({ format: "text/turtle", baseIRI: sharingRegistryUrl });
  const quads = parser.parse(text);
  const store = new Store(quads);

  const buildingNode = DataFactory.namedNode(buildingUri);
  const sharedWithPredicate = DataFactory.namedNode(
    "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#sharedWith"
  );
  const webIdNode = DataFactory.namedNode(webId);

  // Remove the specific triple
  store.removeQuad(buildingNode, sharedWithPredicate, webIdNode, DataFactory.defaultGraph());

  const writer = new Writer({ format: "text/turtle" });
  const updatedTtl = writer.quadsToString(store.getQuads(null, null, null, null));

  await session.fetch(sharingRegistryUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: updatedTtl,
  });
}

async function removeFromACL(
  resourceUri: string,
  webId: string,
  session: Session
): Promise<void> {
  const aclUrl = `${resourceUri}.acl`;
  const response = await session.fetch(aclUrl);

  if (!response.ok) {
    console.warn(`ACL not found for ${resourceUri}`);
    return;
  }

  const aclText = await response.text();

  // Split into blocks on blank lines, drop any block that mentions this WebID,
  // then reassemble. This avoids re-serialising with n3 Writer (which changes
  // relative IRIs to absolute ones and can cause 400s on some Solid servers).
  const blocks = aclText.split(/\n{2,}/);
  const escapedWebId = webId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const webIdPattern = new RegExp(`acl:agent\\s*<${escapedWebId}>`);
  const filtered = blocks.filter((block) => !webIdPattern.test(block));
  const updatedAcl = filtered.join("\n\n");

  await session.fetch(aclUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: updatedAcl,
  });
}

/**
 * Returns the URI(s) whose ACL entry needs to be removed when revoking energy access.
 * - Dummy/investor role: single energy file URI
 * - User role: the parent container URI (covers all daily files via acl:default)
 */
async function getEnergyAclTargets(buildingUri: string, session: Session): Promise<string[]> {
  try {
    const response = await session.fetch(buildingUri);
    const text = await response.text();
    const parser = new Parser({ format: "text/turtle", baseIRI: buildingUri });
    const quads = parser.parse(text);
    const store = new Store(quads);

    const buildingId = buildingUri.split("/").pop()?.replace(".ttl", "");
    const buildingNode = DataFactory.namedNode(`${buildingUri}#${buildingId}`);
    const datasetLocationPredicate = DataFactory.namedNode(
      "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#datasetLocation"
    );

    // Dummy/investor role: hasEnergyMeasurementData - single file
    const measurementPredicate = DataFactory.namedNode(
      "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasEnergyMeasurementData"
    );
    const measurementQuads = store.getQuads(buildingNode, measurementPredicate, null, null);
    if (measurementQuads.length > 0) {
      const locQuads = store.getQuads(measurementQuads[0].object, datasetLocationPredicate, null, null);
      if (locQuads.length > 0) return [locQuads[0].object.value];
    }

    // User role: hasEnergyConsumptionDataset - derive common container from first daily file
    const consumptionPredicate = DataFactory.namedNode(
      "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasEnergyConsumptionDataset"
    );
    const datasetQuads = store.getQuads(buildingNode, consumptionPredicate, null, null);
    if (datasetQuads.length > 0) {
      const locQuads = store.getQuads(datasetQuads[0].object, datasetLocationPredicate, null, null);
      if (locQuads.length > 0) {
        const fileUrl = locQuads[0].object.value;
        // Return the container URL (e.g. .../energy/) so acl:default covers all files
        const containerUrl = fileUrl.substring(0, fileUrl.lastIndexOf("/") + 1);
        return [containerUrl];
      }
    }

    return [];
  } catch (_error) {
    return [];
  }
}

/**
 * Toggle visibility of a building shared with the user
 */
export async function toggleBuildingVisibility(
  buildingUri: string,
  session: Session
): Promise<void> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  const webId = session.info.webId;
  const podBaseUrl = getPodBaseUrl(webId);
  const hiddenBuildingsUrl = `${podBaseUrl}granergize/hiddenBuildings.ttl`;

  const response = await session.fetch(hiddenBuildingsUrl);
  
  let store: Store;
  if (response.status === 404) {
    store = new Store();
  } else {
    const text = await response.text();
    const parser = new Parser({ format: "text/turtle", baseIRI: hiddenBuildingsUrl });
    const quads = parser.parse(text);
    store = new Store(quads);
  }

  const registryNode = DataFactory.namedNode(hiddenBuildingsUrl);
  const hiddenPredicate = DataFactory.namedNode(
    "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hiddenBuilding"
  );
  const buildingNode = DataFactory.namedNode(buildingUri);

  const existingQuads = store.getQuads(registryNode, hiddenPredicate, buildingNode, null);

  if (existingQuads.length > 0) {
    // Building is hidden, make it visible
    existingQuads.forEach((quad) => store.removeQuad(quad));
  } else {
    // Building is visible, hide it
    store.addQuad(registryNode, hiddenPredicate, buildingNode);
  }

  const writer = new Writer({ format: "text/turtle" });
  const updatedTtl = writer.quadsToString(store.getQuads(null, null, null, null));

  await session.fetch(hiddenBuildingsUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: updatedTtl,
  });
}

/**
 * Record that a building has been shared with someone
 */
export async function recordSharing(
  buildingUri: string,
  webId: string,
  session: Session
): Promise<void> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  const userWebId = session.info.webId;
  const podBaseUrl = userWebId.substring(0, userWebId.lastIndexOf("/") + 1);
  const sharingRegistryUrl = `${podBaseUrl}granergize/sharingRegistry.ttl`;

  let store: Store;
  const response = await session.fetch(sharingRegistryUrl);
  
  if (response.status === 404) {
    store = new Store();
  } else {
    const text = await response.text();
    const parser = new Parser({ format: "text/turtle", baseIRI: sharingRegistryUrl });
    const quads = parser.parse(text);
    store = new Store(quads);
  }

  const buildingNode = DataFactory.namedNode(buildingUri);
  const sharedWithPredicate = DataFactory.namedNode(
    "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#sharedWith"
  );
  const webIdNode = DataFactory.namedNode(webId);

  // Add the triple if it doesn't exist
  const existingQuads = store.getQuads(buildingNode, sharedWithPredicate, webIdNode, null);
  if (existingQuads.length === 0) {
    store.addQuad(buildingNode, sharedWithPredicate, webIdNode);
  }

  const writer = new Writer({ format: "text/turtle" });
  const updatedTtl = writer.quadsToString(store.getQuads(null, null, null, null));

  await session.fetch(sharingRegistryUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: updatedTtl,
  });
}

/**
 * Send a notification to the user that their access has been revoked
 */
async function notifyAccessRevoked(
  buildingUri: string,
  webId: string,
  session: Session
): Promise<void> {
  // Get the user's inbox URL
  const parser = new Parser({ format: "text/turtle", baseIRI: webId });
  const profileResponse = await session.fetch(webId, { method: "GET" });

  if (!profileResponse.ok) {
    throw new Error(
      `Failed to fetch WebID profile at ${webId}: ${profileResponse.statusText}`
    );
  }

  const profileText = await profileResponse.text();
  const quads = parser.parse(profileText);
  const store = new Store(quads);

  const inboxPredicate = DataFactory.namedNode(
    "http://www.w3.org/ns/ldp#inbox"
  );
  const webIdNode = DataFactory.namedNode(webId);
  const inboxQuads = store.getQuads(webIdNode, inboxPredicate, null, null);

  if (inboxQuads.length === 0) {
    throw new Error(`No inbox found for WebID ${webId}`);
  }

  const inboxUrl = inboxQuads[0].object.value;

  // Create the revocation notification message
  const message = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix interop: <http://www.w3.org/ns/solid/interop#> .

<#revocation${Date.now()}>
    a interop:AccessRevocation ;
    interop:revokedBy <${session.info.webId}> ;
    interop:revokedAt "${new Date().toISOString()}"^^xsd:dateTime ;
    interop:grantee <${webId}> ;
    interop:forResource <${buildingUri}> .`;

  // Post the message to the inbox
  const postResponse = await session.fetch(inboxUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/turtle",
    },
    body: message,
  });

  if (!postResponse.ok) {
    throw new Error(
      `Failed to post revocation message to inbox at ${inboxUrl}: ${postResponse.statusText}`
    );
  }

  console.log(`Successfully posted access revocation notification to inbox at ${inboxUrl}`);
}

/**
 * Record that an aggregated view has been shared with someone
 */
export async function recordViewSharing(
  snapshotUrl: string,
  viewId: string,
  webId: string,
  session: Session
): Promise<void> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  const userWebId = session.info.webId;
  const podBaseUrl = userWebId.substring(0, userWebId.lastIndexOf("/") + 1);
  const viewSharingRegistryUrl = `${podBaseUrl}granergize/views/viewSharingRegistry.ttl`;

  let store: Store;
  const response = await session.fetch(viewSharingRegistryUrl);
  
  if (response.status === 404) {
    store = new Store();
  } else if (response.ok) {
    const text = await response.text();
    const parser = new Parser({ format: "text/turtle", baseIRI: viewSharingRegistryUrl });
    const quads = parser.parse(text);
    store = new Store(quads);
  } else {
    store = new Store();
  }

  const snapshotNode = DataFactory.namedNode(snapshotUrl);
  const sharedWithPredicate = DataFactory.namedNode(
    "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#sharedWith"
  );
  const viewIdPredicate = DataFactory.namedNode(
    "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#viewId"
  );
  const webIdNode = DataFactory.namedNode(webId);

  // Add the sharedWith triple if it doesn't exist
  const existingQuads = store.getQuads(snapshotNode, sharedWithPredicate, webIdNode, null);
  if (existingQuads.length === 0) {
    store.addQuad(snapshotNode, sharedWithPredicate, webIdNode);
  }

  // Add viewId reference if not exists
  const existingViewIdQuads = store.getQuads(snapshotNode, viewIdPredicate, null, null);
  if (existingViewIdQuads.length === 0) {
    store.addQuad(
      snapshotNode,
      viewIdPredicate,
      DataFactory.literal(viewId)
    );
  }

  const writer = new Writer({ format: "text/turtle" });
  const updatedTtl = writer.quadsToString(store.getQuads(null, null, null, null));

  await session.fetch(viewSharingRegistryUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: updatedTtl,
  });
}

interface SharedView {
  snapshotUrl: string;
  viewId: string;
  sharedWith: string[];
}

/**
 * Get list of views the user has shared with others
 */
export async function getSharedViews(session: Session): Promise<SharedView[]> {
  if (!session.info.isLoggedIn || !session.info.webId) {
    throw new Error("User is not logged in");
  }

  const webId = session.info.webId;
  const podBaseUrl = getPodBaseUrl(webId);
  const viewSharingRegistryUrl = `${podBaseUrl}granergize/views/viewSharingRegistry.ttl`;

  try {
    const response = await session.fetch(viewSharingRegistryUrl);
    
    if (response.status === 404) {
      // Create an empty view sharing registry for future use
      await session.fetch(viewSharingRegistryUrl, {
        method: "PUT",
        headers: { "Content-Type": "text/turtle" },
        body: "",
      });
      return [];
    }
    
    if (!response.ok) {
      throw new Error(`Failed to fetch view sharing registry: ${response.statusText}`);
    }

    const text = await response.text();
    const parser = new Parser({ format: "text/turtle", baseIRI: viewSharingRegistryUrl });
    const quads = parser.parse(text);
    const store = new Store(quads);

    const sharedWithPredicate = DataFactory.namedNode(
      "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#sharedWith"
    );
    const viewIdPredicate = DataFactory.namedNode(
      "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#viewId"
    );

    const viewsMap = new Map<string, { viewId: string; sharedWith: Set<string> }>();

    // Get all sharedWith relations
    const sharedQuads = store.getQuads(null, sharedWithPredicate, null, null);
    sharedQuads.forEach((quad) => {
      const snapshotUrl = quad.subject.value;
      const targetWebId = quad.object.value;

      if (!viewsMap.has(snapshotUrl)) {
        // Get viewId for this snapshot
        const viewIdQuads = store.getQuads(quad.subject, viewIdPredicate, null, null);
        const viewId = viewIdQuads.length > 0 ? viewIdQuads[0].object.value : "";
        viewsMap.set(snapshotUrl, { viewId, sharedWith: new Set() });
      }
      viewsMap.get(snapshotUrl)!.sharedWith.add(targetWebId);
    });

    return Array.from(viewsMap.entries()).map(([snapshotUrl, data]) => ({
      snapshotUrl,
      viewId: data.viewId,
      sharedWith: Array.from(data.sharedWith),
    }));
  } catch (error) {
    console.error("Error getting shared views:", error);
    return [];
  }
}

/**
 * Revoke access to an aggregated view for a specific user
 */
export async function revokeViewAccess(
  snapshotUrl: string,
  webId: string,
  session: Session
): Promise<void> {
  if (!session.info.isLoggedIn) {
    throw new Error("User is not logged in");
  }

  // Remove from view sharing registry
  await removeFromViewSharingRegistry(snapshotUrl, webId, session);

  // Remove from ACL
  await removeFromACL(snapshotUrl, webId, session);
}

async function removeFromViewSharingRegistry(
  snapshotUrl: string,
  webId: string,
  session: Session
): Promise<void> {
  const userWebId = session.info.webId!;
  const podBaseUrl = getPodBaseUrl(userWebId);
  const viewSharingRegistryUrl = `${podBaseUrl}granergize/views/viewSharingRegistry.ttl`;

  const response = await session.fetch(viewSharingRegistryUrl);
  
  if (response.status === 404) {
    return;
  }

  const text = await response.text();
  const parser = new Parser({ format: "text/turtle", baseIRI: viewSharingRegistryUrl });
  const quads = parser.parse(text);
  const store = new Store(quads);

  const snapshotNode = DataFactory.namedNode(snapshotUrl);
  const sharedWithPredicate = DataFactory.namedNode(
    "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#sharedWith"
  );
  const webIdNode = DataFactory.namedNode(webId);

  // Remove the specific triple
  store.removeQuad(snapshotNode, sharedWithPredicate, webIdNode, DataFactory.defaultGraph());

  // Check if there are any remaining sharedWith for this snapshot
  const remainingQuads = store.getQuads(snapshotNode, sharedWithPredicate, null, null);
  if (remainingQuads.length === 0) {
    // Remove the viewId triple too since no one has access anymore
    const viewIdPredicate = DataFactory.namedNode(
      "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#viewId"
    );
    const viewIdQuads = store.getQuads(snapshotNode, viewIdPredicate, null, null);
    viewIdQuads.forEach((quad) => store.removeQuad(quad));
  }

  const writer = new Writer({ format: "text/turtle" });
  const updatedTtl = writer.quadsToString(store.getQuads(null, null, null, null));

  await session.fetch(viewSharingRegistryUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: updatedTtl,
  });
}

import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import { recordSharing, recordViewSharing } from "./sharingManager.ts";
import type { UserRole } from "../../../types/types.ts";

const GRAN_NS = "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#";
const ROLE_TO_IRI: Record<string, string> = {
  dummy:                      `${GRAN_NS}DummyRole`,
  investor:                   `${GRAN_NS}InvestorRole`,
  user:                       `${GRAN_NS}UserRoleInstance`,
  benchmark_service_provider: `${GRAN_NS}BenchmarkRole`,
};

export interface ShareOptions {
  includeEnergyData: boolean;
  /** The role for which this building data is being shared */
  role?: UserRole;
}

export async function shareBuildingData(
    buildingUri: string,
    webId: string,
    session: Session,
    options: ShareOptions = { includeEnergyData: true },
) {
    // Always share the building's static data
    await shareData(buildingUri.split("#")[0], webId, session);
    
    // Conditionally share energy data based on options
    if (options.includeEnergyData) {
        const energyUrls = await getEnergyDataUrls(buildingUri.split("#")[0], session);
        if (energyUrls.length === 0) {
            throw new Error(`No energy data URLs found for building: ${buildingUri}`);
        }
        if (!options.role || options.role === "dummy" || options.role === "investor") {
            // Single file (dummy/investor role) - share the file directly
            await shareData(energyUrls[0].split("#")[0], webId, session);
        } else {
            // Multiple daily files (user role) - share the parent container once
            // All URLs share a common directory, so derive it from the first URL
            const containerUrl = energyUrls[0].substring(0, energyUrls[0].lastIndexOf("/") + 1);
            await shareContainer(containerUrl, webId, session);
        }
    }
    
    await postToInbox(buildingUri.split("#")[0], webId, session, options);
    
    // Record the sharing in our registry
    await recordSharing(buildingUri.split("#")[0], webId, session);
}

async function postToInbox(
    buildingUri: string,
    webId: string,
    session: Session,
    options: ShareOptions,
) {
    const parser = new Parser({ format: "text/turtle", baseIRI: webId });
    const profileResponse = await session.fetch(webId, { method: "GET" });

    if (!profileResponse.ok) {
        throw new Error(
            `Failed to fetch WebID profile at ${webId}: ${profileResponse.statusText}`,
        );
    }

    const profileText = await profileResponse.text();
    const quads = parser.parse(profileText);
    const store = new Store(quads);

    const inboxPredicate = DataFactory.namedNode(
        "http://www.w3.org/ns/ldp#inbox",
    );
    const webIdNode = DataFactory.namedNode(webId);
    const inboxQuads = store.getQuads(
        webIdNode,
        inboxPredicate,
        null,
        null,
    );

    if (inboxQuads.length === 0) {
        throw new Error(`No inbox found for WebID ${webId}`);
    }

    const inboxUrl = inboxQuads[0].object.value;

    // Build optional role triple
    const roleIri = options.role ? (ROLE_TO_IRI[options.role] ?? `${GRAN_NS}DummyRole`) : null;
    const roleTriple = roleIri ? `\n    gran:dataSourceRole <${roleIri}> ;` : "";

    // Create the notification message
    const message = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix interop: <http://www.w3.org/ns/solid/interop#> .
@prefix gran: <https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#> .

<#grant${Date.now()}>
    a interop:AccessGrant ;
    interop:grantedBy <${session.info.webId}> ;
    interop:grantedAt "${new Date().toISOString()}"^^xsd:dateTime ;
    interop:grantee <${webId}> ;
    interop:includesEnergyData "${options.includeEnergyData}"^^xsd:boolean ;${roleTriple}
    interop:hasDataGrant
        [ a interop:DataGrant ;
          interop:forResource <${buildingUri}> ;
          interop:accessMode acl:Read
        ] .`;

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
            `Failed to post message to inbox at ${inboxUrl}: ${postResponse.statusText}`,
        );
    }

    console.log(`Successfully posted access grant message to inbox at ${inboxUrl}`);
}

async function getEnergyDataUrls(
  buildingUri: string,
  session: Session,
): Promise<string[]> {
    const parser = new Parser({ format: "text/turtle", baseIRI: buildingUri });
    const buildingResponse = await session.fetch(buildingUri, { method: "GET" });

    if (!buildingResponse.ok) {
        throw new Error(
            `Failed to fetch building data at ${buildingUri}: ${buildingResponse.statusText}`,
        );
    }
    
    const buildingText = await buildingResponse.text();
    const quads = parser.parse(buildingText);
    const store = new Store(quads);

    console.log(`[getEnergyDataUrls] all predicates:`, [...new Set(store.getQuads(null, null, null, null).map(q => q.predicate.value))]);
    const datasetLocationPredicate = DataFactory.namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#datasetLocation"
    );

    // Dummy/Investor role: single energy file via hasEnergyMeasurementData
    const energyDataPredicate = DataFactory.namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasEnergyMeasurementData"
    );
    const measurementQuads = store.getQuads(null, energyDataPredicate, null, null);
    console.log(`[getEnergyDataUrls] hasEnergyMeasurementData quads (${measurementQuads.length}):`, measurementQuads.map(q => `${q.subject.value} → ${q.object.value}`));
    if (measurementQuads.length > 0) {
        const blankNode = measurementQuads[0].object;
        const locationQuads = store.getQuads(blankNode, datasetLocationPredicate, null, null);
        console.log(`[getEnergyDataUrls] datasetLocation quads for blank node (${locationQuads.length}):`, locationQuads.map(q => q.object.value));
        if (locationQuads.length > 0) {
            return [locationQuads[0].object.value];
        }
    }

    // User role: multiple daily files via hasEnergyConsumptionDataset
    const consumptionDataPredicate = DataFactory.namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasEnergyConsumptionDataset"
    );
    const datasetQuads = store.getQuads(null, consumptionDataPredicate, null, null);
    console.log(`[getEnergyDataUrls] hasEnergyConsumptionDataset quads (${datasetQuads.length}):`, datasetQuads.map(q => `${q.subject.value} → ${q.object.value}`));
    if (datasetQuads.length > 0) {
        const urls: string[] = [];
        for (const dq of datasetQuads) {
            const locationQuads = store.getQuads(dq.object, datasetLocationPredicate, null, null);
            if (locationQuads.length > 0) {
                urls.push(locationQuads[0].object.value);
            }
        }
        if (urls.length > 0) return urls;
    }

    throw new Error(`No energy data resource found for building ${buildingUri}`);
}

/**
 * Share a Solid container with acl:default so all child resources are accessible.
 */
async function shareContainer(
  containerUrl: string,
  webId: string,
  session: Session,
) {
  if (!session.info.isLoggedIn) {
    throw new Error("User is not logged in");
  }

  console.log(`Sharing container ${containerUrl} with WebID ${webId}`);

  const aclUrl = `${containerUrl}.acl`;
  const existingAclResponse = await session.fetch(aclUrl, { method: "GET" });

  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const ACL = "http://www.w3.org/ns/auth/acl#";

  let aclContent = "";
  if (existingAclResponse.status === 404) {
    const ownerWebId = session.info.webId as string;
    aclContent = [
      `<${aclUrl}#ControlReadWrite> <${RDF_TYPE}> <${ACL}Authorization> .`,
      `<${aclUrl}#ControlReadWrite> <${ACL}agent> <${ownerWebId}> .`,
      `<${aclUrl}#ControlReadWrite> <${ACL}accessTo> <${containerUrl}> .`,
      `<${aclUrl}#ControlReadWrite> <${ACL}default> <${containerUrl}> .`,
      `<${aclUrl}#ControlReadWrite> <${ACL}mode> <${ACL}Read> .`,
      `<${aclUrl}#ControlReadWrite> <${ACL}mode> <${ACL}Write> .`,
      `<${aclUrl}#ControlReadWrite> <${ACL}mode> <${ACL}Control> .`,
    ].join("\n") + "\n";
  } else {
    aclContent = await existingAclResponse.text();
  }

  // Grant read on the container itself and all its children (acl:default)
  const authLabel = `Read_${webId.replace(/[^a-zA-Z0-9]/g, "_")}`;
  aclContent += [
    `<${aclUrl}#${authLabel}> <${RDF_TYPE}> <${ACL}Authorization> .`,
    `<${aclUrl}#${authLabel}> <${ACL}agent> <${webId}> .`,
    `<${aclUrl}#${authLabel}> <${ACL}accessTo> <${containerUrl}> .`,
    `<${aclUrl}#${authLabel}> <${ACL}default> <${containerUrl}> .`,
    `<${aclUrl}#${authLabel}> <${ACL}mode> <${ACL}Read> .`,
  ].join("\n") + "\n";

  const putResponse = await session.fetch(aclUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: aclContent,
  });

  if (!putResponse.ok) {
    throw new Error(
      `Failed to update container ACL: ${putResponse.status} ${putResponse.statusText}`,
    );
  }

  console.log(`Successfully shared container ${containerUrl} with ${webId}`);
}

async function shareData(
  resourceUri: string,
  webId: string,
  session: Session,
) {
  if (!session.info.isLoggedIn) {
    throw new Error("User is not logged in");
  }

  console.log(`Sharing resource ${resourceUri} with WebID ${webId}`);

  // Check if acl exists, if not create it
  const aclUrl = `${resourceUri}.acl`;
  const existingAclResponse = await session.fetch(aclUrl, {
    method: "GET",
  });

  const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
  const ACL = "http://www.w3.org/ns/auth/acl#";

  let aclContent = "";
  if (existingAclResponse.status === 404) {
    // Create a basic ACL granting the owner full access (N-Triples format)
    const ownerWebId = session.info.webId as string;
    aclContent = [
      `<${aclUrl}#ControlReadWrite> <${RDF_TYPE}> <${ACL}Authorization> .`,
      `<${aclUrl}#ControlReadWrite> <${ACL}agent> <${ownerWebId}> .`,
      `<${aclUrl}#ControlReadWrite> <${ACL}accessTo> <${resourceUri}> .`,
      `<${aclUrl}#ControlReadWrite> <${ACL}mode> <${ACL}Read> .`,
      `<${aclUrl}#ControlReadWrite> <${ACL}mode> <${ACL}Write> .`,
      `<${aclUrl}#ControlReadWrite> <${ACL}mode> <${ACL}Control> .`,
    ].join("\n") + "\n";
  } else {
    aclContent = await existingAclResponse.text();
  }

  // Append new authorization in N-Triples format (no prefixes needed, valid Turtle subset)
  const authLabel = `Read_${webId.replace(/[^a-zA-Z0-9]/g, "_")}`;
  aclContent += [
    `<${aclUrl}#${authLabel}> <${RDF_TYPE}> <${ACL}Authorization> .`,
    `<${aclUrl}#${authLabel}> <${ACL}agent> <${webId}> .`,
    `<${aclUrl}#${authLabel}> <${ACL}accessTo> <${resourceUri}> .`,
    `<${aclUrl}#${authLabel}> <${ACL}mode> <${ACL}Read> .`,
  ].join("\n") + "\n";

  // Save the updated ACL
  const putResponse = await session.fetch(aclUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "text/turtle",
    },
    body: aclContent,
  });

  if (!putResponse.ok) {
    const errorBody = await putResponse.text();
    console.error(`[shareData] PUT error body: ${errorBody}`);
    throw new Error(
      `Failed to update ACL: ${putResponse.status} ${putResponse.statusText}`,
    );
  }

  console.log(`Successfully shared building ${resourceUri} with ${webId}`);
}

/**
 * Share an aggregated view snapshot with another user
 * Only the computed snapshot is shared (not the view definition with building URIs)
 */
export async function shareAggregatedView(
  snapshotUrl: string,
  viewId: string,
  webId: string,
  session: Session
): Promise<void> {
  if (!session.info.isLoggedIn) {
    throw new Error("User is not logged in");
  }

  console.log(`Sharing aggregated view ${snapshotUrl} with WebID ${webId}`);

  // Share the snapshot resource (sets ACL)
  await shareData(snapshotUrl, webId, session);

  // Post notification to recipient's inbox
  await postViewGrantToInbox(snapshotUrl, viewId, webId, session);

  // Record the sharing in our registry
  await recordViewSharing(snapshotUrl, viewId, webId, session);
}

/**
 * Post an access grant notification for an aggregated view to recipient's inbox
 */
async function postViewGrantToInbox(
  snapshotUrl: string,
  viewId: string,
  webId: string,
  session: Session
): Promise<void> {
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

  const inboxPredicate = DataFactory.namedNode("http://www.w3.org/ns/ldp#inbox");
  const webIdNode = DataFactory.namedNode(webId);
  const inboxQuads = store.getQuads(webIdNode, inboxPredicate, null, null);

  if (inboxQuads.length === 0) {
    throw new Error(`No inbox found for WebID ${webId}`);
  }

  const inboxUrl = inboxQuads[0].object.value;

  // Create the notification message for aggregated view
  const message = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix interop: <http://www.w3.org/ns/solid/interop#> .
@prefix gra: <https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#> .

<#grant${Date.now()}>
    a interop:AccessGrant ;
    interop:grantedBy <${session.info.webId}> ;
    interop:grantedAt "${new Date().toISOString()}"^^xsd:dateTime ;
    interop:grantee <${webId}> ;
    gra:resourceType gra:AggregatedViewSnapshot ;
    gra:viewId "${viewId}" ;
    interop:hasDataGrant
        [ a interop:DataGrant ;
          interop:forResource <${snapshotUrl}> ;
          interop:accessMode acl:Read
        ] .`;

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
      `Failed to post view grant message to inbox at ${inboxUrl}: ${postResponse.statusText}`
    );
  }

  console.log(`Successfully posted view access grant to inbox at ${inboxUrl}`);
}


import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";
import { recordSharing, recordViewSharing } from "./sharingManager.ts";

export interface ShareOptions {
  includeEnergyData: boolean;
}

export async function shareBuildingData(
    buildingUri: string,
    webId: string,
    session: Session,
    options: ShareOptions = { includeEnergyData: true },
) {
    // Always share the building's static data
    await shareData(buildingUri, webId, session);
    
    // Conditionally share energy data based on options
    if (options.includeEnergyData) {
        const energyData = await getEnergyData(buildingUri, session);
        await shareData(energyData, webId, session);
    }
    
    await postToInbox(buildingUri, webId, session, options);
    
    // Record the sharing in our registry
    await recordSharing(buildingUri, webId, session);
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

    // Create the notification message
    const message = `
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix interop: <http://www.w3.org/ns/solid/interop#> .

<#grant${Date.now()}>
    a interop:AccessGrant ;
    interop:grantedBy <${session.info.webId}> ;
    interop:grantedAt "${new Date().toISOString()}"^^xsd:dateTime ;
    interop:grantee <${webId}> ;
    interop:includesEnergyData "${options.includeEnergyData}"^^xsd:boolean ;
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

async function getEnergyData(
  buildingUri: string,
  session: Session,
): Promise<string> {
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

    const buildingNode = DataFactory.namedNode(buildingUri + "#" + buildingUri.split("/").pop()?.replace(".ttl", ""));
    const energyDataPredicate = DataFactory.namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasEnergyMeasurementData"
    );
    const datasetLocationPredicate = DataFactory.namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#datasetLocation"
    );

    // Find the blank node for hasEnergyMeasurementData
    const energyDataQuads = store.getQuads(
        buildingNode,
        energyDataPredicate,
        null,
        null,
    );

    if (energyDataQuads.length === 0) {
        throw new Error(`No energy data resource found for building ${buildingUri}`);
    }

    const blankNode = energyDataQuads[0].object;

    // Find the datasetLocation for that blank node
    const datasetLocationQuads = store.getQuads(
        blankNode,
        datasetLocationPredicate,
        null,
        null,
    );

    if (datasetLocationQuads.length === 0) {
        throw new Error(`No datasetLocation found for energy data of building ${buildingUri}`);
    }

    return datasetLocationQuads[0].object.value;
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

  let aclContent = "";
  if (existingAclResponse.status === 404) {
    // Create a basic ACL granting the owner full access
    const ownerWebId = session.info.webId as string;
    aclContent = `
@prefix : <#>.
@prefix acl: <http://www.w3.org/ns/auth/acl#>.

:ControlReadWrite
    a acl:Authorization;
    acl:agent <${ownerWebId}>;
    acl:accessTo <${resourceUri}>;
    acl:mode acl:Read, acl:Write, acl:Control.
`;
  } else {
    aclContent = await existingAclResponse.text();
  }

  // Append a new authorization for the shared WebID
  const newAuthorization = `
:Read
    a acl:Authorization;
    acl:agent <${webId}>;
    acl:accessTo <${resourceUri}>;
    acl:mode acl:Read.
`;

  aclContent += newAuthorization;

  // Save the updated ACL
  const putResponse = await session.fetch(aclUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "text/turtle",
    },
    body: aclContent,
  });

  if (!putResponse.ok) {
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


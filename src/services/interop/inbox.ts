import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store, Writer } from "n3";
import { registryUrl as registryUrlFor } from "../utils/solidUtils.ts";
import { fetchFresh } from "../utils/podFetch.ts";

export async function readInbox(session: Session) {
  if (!session.info.isLoggedIn) {
    throw new Error("User is not logged in");
  }

  console.log("Reading inbox for WebID:", session.info.webId);

  const podInbox = await getInboxUrl(session.info.webId as string);

  if (!session) {
    console.error("Session is undefined");
    throw new Error("Session is undefined");
  }
  const response = await session.fetch(podInbox, {
    method: "GET",
  });
  if (response.status === 200) {
    const inboxText = await response.text();
    const parser = new Parser({ format: "text/turtle", baseIRI: podInbox });
    const quads = parser.parse(inboxText);
    const store = new Store(quads);

    const messageUrls = store.getQuads(
      null,
      DataFactory.namedNode("http://www.w3.org/ns/ldp#contains"),
      null,
      null,
    ).map((q) => q.object.value);

    // Process each message fully (fetch → parse → registry update → delete) before returning
    await Promise.all(messageUrls.map(async (messageUrl) => {
      const msgResponse = await session.fetch(messageUrl, { method: "GET" });
      if (msgResponse.status !== 200) {
        console.error(
          `Failed to fetch message at ${messageUrl}: ${msgResponse.statusText}`,
        );
        return;
      }

      const msgText = await msgResponse.text();
      const msgParser = new Parser({
        format: "text/turtle",
        baseIRI: messageUrl,
      });
      const msgStore = new Store(msgParser.parse(msgText));

      const innerPromises: Promise<void>[] = [];

      // Check if this message grants access to buildings data
      msgStore.getQuads(
        null,
        DataFactory.namedNode(
          "http://www.w3.org/ns/solid/interop#hasDataGrant",
        ),
        null,
        null,
      ).forEach((dataGrantQuad) => {
        const grantNode = dataGrantQuad.subject;
        const dataGrantNode = dataGrantQuad.object;

        const roleQuads = msgStore.getQuads(
          grantNode,
          DataFactory.namedNode(
            "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#dataSourceRole",
          ),
          null,
          null,
        );
        const roleIri =
          roleQuads.length > 0 && roleQuads[0].object.termType === "NamedNode"
            ? roleQuads[0].object.value
            : undefined;

        const forResourceQuads = msgStore.getQuads(
          dataGrantNode,
          DataFactory.namedNode(
            "http://www.w3.org/ns/solid/interop#forResource",
          ),
          null,
          null,
        );
        const accessModeQuads = msgStore.getQuads(
          dataGrantNode,
          DataFactory.namedNode(
            "http://www.w3.org/ns/solid/interop#accessMode",
          ),
          null,
          null,
        );

        forResourceQuads.forEach((forResourceQuad) => {
          const resource = forResourceQuad.object.value;
          accessModeQuads.forEach((accessModeQuad) => {
            const accessMode = accessModeQuad.object.value;
            console.log(
              `Granted ${accessMode} access to resource: ${resource}` +
                (roleIri ? ` (role: ${roleIri})` : ""),
            );
            innerPromises.push(
              addResourceToRegistry(session, resource, accessMode, roleIri),
            );
          });
        });
      });

      // Check for revocation messages
      msgStore.getQuads(
        null,
        DataFactory.namedNode(
          "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
        ),
        DataFactory.namedNode(
          "http://www.w3.org/ns/solid/interop#AccessRevocation",
        ),
        null,
      ).forEach((revocationQuad) => {
        const revocationNode = revocationQuad.subject;
        msgStore.getQuads(
          revocationNode,
          DataFactory.namedNode(
            "http://www.w3.org/ns/solid/interop#forResource",
          ),
          null,
          null,
        ).forEach((forResourceQuad) => {
          const resource = forResourceQuad.object.value;
          console.log(`Revoking access to resource: ${resource}`);
          innerPromises.push(removeResourceFromRegistry(session, resource));
        });
      });

      // Await registry updates first, then delete the message
      await Promise.all(innerPromises);
      await removeMessageFromInbox(session, messageUrl, podInbox);
    }));
  }
}

async function removeResourceFromRegistry(session: Session, resource: string) {
  const webId = session.info.webId!;
  const registryUrl = registryUrlFor(webId);

  const response = await fetchFresh(registryUrl, session);
  if (!response.ok) return;

  const text = await response.text();
  const parser = new Parser({ format: "text/turtle", baseIRI: registryUrl });
  const store = new Store(parser.parse(text));

  const registryNode = DataFactory.namedNode(registryUrl);
  const buildingSourcePredicate = DataFactory.namedNode(
    "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasBuildingDataSource",
  );
  const dataSourceRolePredicate = DataFactory.namedNode(
    "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#dataSourceRole",
  );
  const resourceNode = DataFactory.namedNode(resource);

  store.getQuads(registryNode, buildingSourcePredicate, resourceNode, null)
    .forEach((q) => store.removeQuad(q));
  store.getQuads(resourceNode, dataSourceRolePredicate, null, null)
    .forEach((q) => store.removeQuad(q));

  const writer = new Writer({ format: "text/turtle" });
  const updatedTtl = writer.quadsToString(
    store.getQuads(null, null, null, null),
  );

  await session.fetch(registryUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle" },
    body: updatedTtl,
  });

  console.log(`Removed resource ${resource} from registry at ${registryUrl}`);
}

async function addResourceToRegistry(
  session: Session,
  resource: string,
  accessMode: string,
  roleIri?: string,
) {
  console.log(
    `Adding resource ${resource} with access mode ${accessMode} to registry` +
      (roleIri ? ` (role: ${roleIri})` : ""),
  );
  const webId = session.info.webId!;
  const registryUrl = registryUrlFor(webId);

  const registryResponse = await fetchFresh(registryUrl, session);

  let registryText = "";
  if (registryResponse.status === 200) {
    registryText = await registryResponse.text();
  } else if (registryResponse.status === 404) {
    console.log("Registry file not found, creating a new one.");
  } else {
    console.error(
      `Failed to fetch registry at ${registryUrl}: ${registryResponse.statusText}`,
    );
    throw new Error(
      `Failed to fetch registry at ${registryUrl}: ${registryResponse.statusText}`,
    );
  }

  const parser = new Parser({ format: "text/turtle", baseIRI: registryUrl });
  const quads = parser.parse(registryText);
  const store = new Store(quads);

  const registryNode = DataFactory.namedNode(registryUrl);
  const accessModeNode = DataFactory.namedNode(
    "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasBuildingDataSource",
  );
  const resourceNode = DataFactory.namedNode(resource);

  store.addQuad(
    registryNode,
    accessModeNode,
    resourceNode,
  );

  // Persist the role annotation as a side triple on the building URL if provided
  if (roleIri) {
    store.addQuad(
      resourceNode,
      DataFactory.namedNode(
        "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#dataSourceRole",
      ),
      DataFactory.namedNode(roleIri),
    );
  }

  const serializedRegistry = store.toString();

  const updateResponse = await session.fetch(registryUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "text/turtle",
    },
    body: serializedRegistry,
  });

  if (!updateResponse.ok) {
    console.error(
      `Failed to update registry at ${registryUrl}: ${updateResponse.statusText}`,
    );
    throw new Error(
      `Failed to update registry at ${registryUrl}: ${updateResponse.statusText}`,
    );
  }

  console.log(`Successfully updated registry at ${registryUrl}`);
}

async function removeMessageFromInbox(
  session: Session,
  messageUrl: string,
  inboxUrl: string,
) {
  console.log(`Removing message ${messageUrl} from inbox ${inboxUrl}`);
  const response = await session.fetch(messageUrl, {
    method: "DELETE",
  });

  if (response.status === 404) {
    // Already deleted (e.g. duplicate processing) — treat as success
    return;
  }

  if (!response.ok) {
    console.error(
      `Failed to delete message at ${messageUrl}: ${response.statusText}`,
    );
    throw new Error(
      `Failed to delete message at ${messageUrl}: ${response.statusText}`,
    );
  }

  console.log(`Successfully deleted message at ${messageUrl}`);
}

async function getInboxUrl(webId: string): Promise<string> {
  const profileResponse = await fetch(webId);

  if (!profileResponse.ok) {
    console.error(
      `Failed to fetch WebID profile: ${profileResponse.statusText}`,
    );
    throw new Error(
      `Failed to fetch WebID profile: ${profileResponse.statusText}`,
    );
  }

  const profileText = await profileResponse.text();
  const parser = new Parser({ format: "text/turtle", baseIRI: webId });
  const quads = parser.parse(profileText);
  const store = new Store(quads);

  const inboxPredicate = DataFactory.namedNode(
    "http://www.w3.org/ns/ldp#inbox",
  );
  const webIdSubject = DataFactory.namedNode(webId);
  const inboxQuads = store.getQuads(webIdSubject, inboxPredicate, null, null);

  if (inboxQuads.length === 0) {
    console.error("Inbox URL not found in WebID profile");
    throw new Error("Inbox URL not found in WebID profile");
  }

  const inboxUrl = inboxQuads[0].object.value;
  return inboxUrl;
}

import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store } from "n3";

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

    // Collect all async operations
    const allPromises: Promise<any>[] = [];

    store.getQuads(
      null,
      DataFactory.namedNode("http://www.w3.org/ns/ldp#contains"),
      null,
      null,
    ).forEach((messageQuad) => {
      const messageUrl = messageQuad.object.value;

      // For each message, fetch and parse its content
      store.getQuads(DataFactory.namedNode(messageUrl), null, null, null)
        .forEach((msgQuad) => {
          const promise = (async () => {
            const msgResponse = await session.fetch(messageUrl, {
              method: "GET",
            });
            if (msgResponse.status === 200) {
              const msgText = await msgResponse.text();
              const msgParser = new Parser({
                format: "text/turtle",
                baseIRI: messageUrl,
              });
              const msgQuads = msgParser.parse(msgText);
              const msgStore = new Store(msgQuads);

              // Check if this message grants access to buildings data
              msgStore.getQuads(
                null,
                DataFactory.namedNode(
                  "http://www.w3.org/ns/solid/interop#hasDataGrant",
                ),
                null,
                null,
              ).forEach((dataGrantQuad) => {
                const dataGrantNode = dataGrantQuad.object;

                // Check the details of the DataGrant
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
                      `Granted ${accessMode} access to resource: ${resource}`,
                    );
                    // Chain both registry update and message removal
                    allPromises.push(addResourceToRegistry(session, resource, accessMode));
                    allPromises.push(removeMessageFromInbox(session, messageUrl, podInbox));
                  });
                });
              });
            } else {
              console.error(
                `Failed to fetch message at ${messageUrl}: ${msgResponse.statusText}`,
              );
            }
          })();
          allPromises.push(promise);
        });
    });

    // Wait for all registry updates and message removals to finish
    await Promise.all(allPromises);
  }
}

async function addResourceToRegistry(session: Session, resource: string, accessMode: string) {
  console.log(
    `Adding resource ${resource} with access mode ${accessMode} to registry`,
  );
  const webId = session.info.webId!;
  const podBaseUrl = webId.substring(0, webId.lastIndexOf("/") + 1);
  const registryUrl = `${podBaseUrl}granergize/dataSources.ttl`;

  const registryResponse = await session.fetch(registryUrl, {
    method: "GET",
  });

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

async function removeMessageFromInbox(session: Session, messageUrl: string, inboxUrl: string) {
  console.log(`Removing message ${messageUrl} from inbox ${inboxUrl}`);
  const response = await session.fetch(messageUrl, {
    method: "DELETE",
  });

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

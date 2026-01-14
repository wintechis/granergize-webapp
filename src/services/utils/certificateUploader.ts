import { Session } from "@inrupt/solid-client-authn-browser";
import { DataFactory, Parser, Store, Writer } from "n3";

/**
 * Uploads an energy certificate PDF to the Solid pod and links it in the building's TTL file
 * @param buildingUri - The URI of the building TTL file
 * @param pdfFile - The PDF file to upload
 * @param session - The authenticated Solid session
 */
export async function uploadEnergyCertificate(
  buildingUri: string,
  pdfFile: File,
  session: Session,
): Promise<void> {
  if (!session.info.isLoggedIn) {
    throw new Error("User is not logged in");
  }

  // Step 1: Determine the location to store the PDF
  // Extract the base URL from the building URI
  const buildingUrl = new URL(buildingUri);
  const pathParts = buildingUrl.pathname.split("/");
  const buildingFileName = pathParts[pathParts.length - 1];
  const buildingId = buildingFileName.replace(".ttl", "");
  
  // Create a certificates folder at the same level as the building file
  const certificatesPath = pathParts.slice(0, -1).join("/") + "/certificates/";
  const certificateFileName = `${buildingId}_energy_certificate.pdf`;
  const certificateUrl = `${buildingUrl.origin}${certificatesPath}${certificateFileName}`;

  console.log(`Uploading certificate to: ${certificateUrl}`);

  // Step 2: Upload the PDF file to the Solid pod
  const uploadResponse = await session.fetch(certificateUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/pdf",
    },
    body: pdfFile,
  });

  if (!uploadResponse.ok) {
    throw new Error(
      `Failed to upload PDF to ${certificateUrl}: ${uploadResponse.statusText}`,
    );
  }

  console.log("PDF uploaded successfully");

  // Step 3: Update the building's TTL file to add the energy certificate link
  await updateBuildingWithCertificateLink(buildingUri, certificateUrl, session);

  console.log("Building TTL updated with certificate link");
}

/**
 * Updates the building's TTL file to include a link to the energy certificate
 */
async function updateBuildingWithCertificateLink(
  buildingUri: string,
  certificateUrl: string,
  session: Session,
): Promise<void> {
  // Step 1: Fetch the current building TTL
  const response = await session.fetch(buildingUri);
  
  if (!response.ok) {
    throw new Error(
      `Failed to fetch building data at ${buildingUri}: ${response.statusText}`,
    );
  }

  const ttlContent = await response.text();

  // Step 2: Parse the TTL content
  const parser = new Parser({ format: "text/turtle", baseIRI: buildingUri });
  const quads = parser.parse(ttlContent);
  const store = new Store(quads);

  // Step 3: Find the building subject node
  // The building ID is typically the hash fragment of the URI
  const buildingFileName = buildingUri.split("/").pop()?.replace(".ttl", "");
  const buildingSubject = DataFactory.namedNode(`${buildingUri}#${buildingFileName}`);

  // Step 4: Check if energy certificate predicate already exists and remove it
  const energyCertificatePredicate = DataFactory.namedNode(
    "https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#hasEnergyCertificate"
  );

  // Remove existing energy certificate triples
  const existingQuads = store.getQuads(
    buildingSubject,
    energyCertificatePredicate,
    null,
    null,
  );
  
  existingQuads.forEach((quad) => {
    store.removeQuad(quad);
  });

  // Step 5: Add the new energy certificate triple
  const certificateObject = DataFactory.namedNode(certificateUrl);
  store.addQuad(
    buildingSubject,
    energyCertificatePredicate,
    certificateObject,
  );

  // Step 6: Serialize the updated store back to TTL
  const writer = new Writer({ format: "text/turtle" });
  const updatedTtl = writer.quadsToString(store.getQuads(null, null, null, null));

  // Step 7: Write the updated TTL back to the pod
  const updateResponse = await session.fetch(buildingUri, {
    method: "PUT",
    headers: {
      "Content-Type": "text/turtle",
    },
    body: updatedTtl,
  });

  if (!updateResponse.ok) {
    throw new Error(
      `Failed to update building TTL at ${buildingUri}: ${updateResponse.statusText}`,
    );
  }
}

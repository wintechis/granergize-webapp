/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { Parser, Store } from "n3";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  getOrganization,
  getProducingRole,
  isSupportedLogoType,
  saveOrganization,
  saveProducingRole,
  uploadOrgLogo,
} from "./organizationManager.ts";
import { PROVENANCE_TO_IRI } from "../../constants/roles.ts";
import { _resetProfileCacheForTesting } from "./profileDocument.ts";

const WEBID = "https://pod.example/profile/card#me";
const PROFILE_DOC = "https://pod.example/profile/card";
const ORG = "https://pod.example/profile/card#org";
const MEMBERSHIP = "https://pod.example/profile/card#membership";

const ORG_MEMBER_OF = "http://www.w3.org/ns/org#memberOf";
const ORG_HAS_MEMBERSHIP = "http://www.w3.org/ns/org#hasMembership";
const ORG_ROLE = "http://www.w3.org/ns/org#role";
const ORG_ORGANIZATION = "http://www.w3.org/ns/org#organization";
const FOAF_NAME = "http://xmlns.com/foaf/0.1/name";
const FOAF_LOGO = "http://xmlns.com/foaf/0.1/logo";
const FOAF_HOMEPAGE = "http://xmlns.com/foaf/0.1/homepage";
const OWL_SAME_AS = "http://www.w3.org/2002/07/owl#sameAs";

/** A fake Session that serves in-memory docs for GET and records PUT writes. */
function makeSession(
  files: Record<string, string>,
  writes: { url: string; contentType: string; body: unknown }[],
): Session {
  const fetchImpl = (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString())
      .split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();

    if (method === "PUT") {
      writes.push({
        url,
        contentType:
          (init?.headers as Record<string, string>)?.["Content-Type"] ?? "",
        body: init?.body,
      });
      files[url] = typeof init?.body === "string" ? init.body : "<binary>";
      return Promise.resolve(new Response(null, { status: 205 }));
    }

    const body = files[url];
    return Promise.resolve(
      body === undefined
        ? new Response("Not found", { status: 404 })
        : new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        }),
    );
  };
  return {
    info: { isLoggedIn: true, webId: WEBID },
    fetch: fetchImpl as unknown as Session["fetch"],
  } as unknown as Session;
}

/** Parse a PUT body and return objects for (subject, predicate). */
function objectsOf(ttl: string, subject: string, predicate: string): string[] {
  const store = new Store(
    new Parser({ format: "text/turtle", baseIRI: PROFILE_DOC }).parse(ttl),
  );
  return store.getObjects(subject, predicate, null).map((o) => o.value);
}

Deno.test("isSupportedLogoType accepts images, rejects others", () => {
  assert(isSupportedLogoType({ type: "image/png" } as File));
  assert(isSupportedLogoType({ type: "image/svg+xml" } as File));
  assert.deepEqual(isSupportedLogoType({ type: "application/pdf" } as File), false);
  assert.deepEqual(isSupportedLogoType({ type: "" } as File), false);
});

Deno.test("getOrganization follows org:memberOf and reads the org fields", async () => {
  _resetProfileCacheForTesting(); // getOrganization reads via the shared cache
  const session = makeSession({
    [PROFILE_DOC]: `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      @prefix org: <http://www.w3.org/ns/org#> .
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      <${WEBID}> org:memberOf <${ORG}> .
      <${ORG}> a org:Organization, foaf:Organization ;
        foaf:name "ACME Logistics" ;
        foaf:logo <https://pod.example/profile/logo.png> ;
        foaf:homepage <https://acme.example/> ;
        owl:sameAs <https://acme.example/profile/card#me> .
    `,
  }, []);

  const org = await getOrganization(session);
  assert.deepEqual(org, {
    name: "ACME Logistics",
    logoUrl: "https://pod.example/profile/logo.png",
    homepage: "https://acme.example/",
    sameAs: "https://acme.example/profile/card#me",
  });
});

Deno.test("getOrganization returns null when no membership is set", async () => {
  _resetProfileCacheForTesting();
  const session = makeSession({
    [PROFILE_DOC]: `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <${WEBID}> foaf:name "Homer" .
    `,
  }, []);
  assert.deepEqual(await getOrganization(session), null);
});

Deno.test("saveOrganization writes membership + org node into the WebID doc", async () => {
  const writes: { url: string; contentType: string; body: unknown }[] = [];
  const session = makeSession({
    [PROFILE_DOC]: `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <${WEBID}> foaf:name "Homer" .
    `,
  }, writes);

  await saveOrganization(session, {
    name: "ACME Logistics",
    homepage: "https://acme.example/",
    sameAs: "https://acme.example/profile/card#me",
  });

  // Single PUT, to the WebID document.
  assert.deepEqual(writes.length, 1);
  assert.deepEqual(writes[0].url, PROFILE_DOC);
  const ttl = writes[0].body as string;

  assert.deepEqual(objectsOf(ttl, WEBID, ORG_MEMBER_OF), [ORG]);
  assert.deepEqual(objectsOf(ttl, ORG, FOAF_NAME), ["ACME Logistics"]);
  assert.deepEqual(objectsOf(ttl, ORG, FOAF_HOMEPAGE), ["https://acme.example/"]);
  assert.deepEqual(objectsOf(ttl, ORG, OWL_SAME_AS), [
    "https://acme.example/profile/card#me",
  ]);
  // The person's pre-existing data is preserved.
  assert.deepEqual(objectsOf(ttl, WEBID, FOAF_NAME), ["Homer"]);
});

Deno.test("saveOrganization replaces values and preserves an existing logo", async () => {
  const writes: { url: string; contentType: string; body: unknown }[] = [];
  const logo = "https://pod.example/profile/logo.png";
  const session = makeSession({
    [PROFILE_DOC]: `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      @prefix org: <http://www.w3.org/ns/org#> .
      <${WEBID}> org:memberOf <${ORG}> .
      <${ORG}> a org:Organization ;
        foaf:name "Old Name" ;
        foaf:logo <${logo}> .
    `,
  }, writes);

  await saveOrganization(session, { name: "New Name" });
  const ttl = writes[0].body as string;

  // Name replaced (no duplicate), logo preserved, homepage cleared (blank).
  assert.deepEqual(objectsOf(ttl, ORG, FOAF_NAME), ["New Name"]);
  assert.deepEqual(objectsOf(ttl, ORG, FOAF_LOGO), [logo]);
  assert.deepEqual(objectsOf(ttl, ORG, FOAF_HOMEPAGE), []);
});

Deno.test("uploadOrgLogo stores the image and links foaf:logo on the org node", async () => {
  const writes: { url: string; contentType: string; body: unknown }[] = [];
  const session = makeSession({
    [PROFILE_DOC]: `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <${WEBID}> foaf:name "Homer" .
    `,
  }, writes);

  const stored = await uploadOrgLogo({ type: "image/png" } as File, session);
  assert.deepEqual(stored, "https://pod.example/profile/logo.png");

  // Image PUT with the right content type.
  const imgPut = writes.find((w) => w.url === stored);
  assert(imgPut, "expected an image PUT");
  assert.deepEqual(imgPut!.contentType, "image/png");

  // Profile PUT links foaf:logo on the org node and establishes membership.
  const profilePut = writes.find((w) => w.url === PROFILE_DOC);
  assert(profilePut, "expected a profile PUT");
  const ttl = profilePut!.body as string;
  assert.deepEqual(objectsOf(ttl, ORG, FOAF_LOGO), [stored]);
  assert.deepEqual(objectsOf(ttl, WEBID, ORG_MEMBER_OF), [ORG]);
});

Deno.test("uploadOrgLogo rejects unsupported types", async () => {
  const session = makeSession({ [PROFILE_DOC]: "" }, []);
  let threw = false;
  try {
    await uploadOrgLogo({ type: "application/pdf" } as File, session);
  } catch {
    threw = true;
  }
  assert(threw, "expected uploadOrgLogo to throw on unsupported type");
});

Deno.test("getProducingRole returns null when no membership role is set", async () => {
  _resetProfileCacheForTesting();
  const session = makeSession({
    [PROFILE_DOC]: `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <${WEBID}> foaf:name "Homer" .
    `,
  }, []);
  assert.deepEqual(await getProducingRole(session), null);
});

Deno.test("saveProducingRole writes org:role on a membership; getProducingRole reads it back", async () => {
  _resetProfileCacheForTesting();
  const writes: { url: string; contentType: string; body: unknown }[] = [];
  const files: Record<string, string> = {
    [PROFILE_DOC]: `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      <${WEBID}> foaf:name "Homer" .
    `,
  };
  const session = makeSession(files, writes);

  await saveProducingRole(session, "investor");

  // Single PUT to the WebID doc, with the membership + role.
  assert.deepEqual(writes.length, 1);
  assert.deepEqual(writes[0].url, PROFILE_DOC);
  const ttl = writes[0].body as string;
  assert.deepEqual(objectsOf(ttl, WEBID, ORG_HAS_MEMBERSHIP), [MEMBERSHIP]);
  assert.deepEqual(objectsOf(ttl, MEMBERSHIP, ORG_ROLE), [
    PROVENANCE_TO_IRI.investor,
  ]);
  // No org set → the membership isn't tied to an org node.
  assert.deepEqual(objectsOf(ttl, MEMBERSHIP, ORG_ORGANIZATION), []);
  // Pre-existing person data preserved.
  assert.deepEqual(objectsOf(ttl, WEBID, FOAF_NAME), ["Homer"]);

  // The PUT updated the served doc — read it back through the cache.
  _resetProfileCacheForTesting();
  assert.deepEqual(await getProducingRole(session), "investor");
});

Deno.test("saveProducingRole ties the membership to the org node when an org is set", async () => {
  _resetProfileCacheForTesting();
  const writes: { url: string; contentType: string; body: unknown }[] = [];
  const session = makeSession({
    [PROFILE_DOC]: `
      @prefix org: <http://www.w3.org/ns/org#> .
      <${WEBID}> org:memberOf <${ORG}> .
    `,
  }, writes);

  await saveProducingRole(session, "benchmark_service_provider");
  const ttl = writes[0].body as string;
  assert.deepEqual(objectsOf(ttl, MEMBERSHIP, ORG_ORGANIZATION), [ORG]);
  assert.deepEqual(objectsOf(ttl, MEMBERSHIP, ORG_ROLE), [
    PROVENANCE_TO_IRI.benchmark_service_provider,
  ]);
  // The existing org membership link is untouched.
  assert.deepEqual(objectsOf(ttl, WEBID, ORG_MEMBER_OF), [ORG]);
});

Deno.test("saveProducingRole(null) clears the membership role", async () => {
  _resetProfileCacheForTesting();
  const writes: { url: string; contentType: string; body: unknown }[] = [];
  const session = makeSession({
    [PROFILE_DOC]: `
      @prefix foaf: <http://xmlns.com/foaf/0.1/> .
      @prefix org: <http://www.w3.org/ns/org#> .
      <${WEBID}> foaf:name "Homer" ; org:hasMembership <${MEMBERSHIP}> .
      <${MEMBERSHIP}> a org:Membership ; org:role <${PROVENANCE_TO_IRI.investor}> .
    `,
  }, writes);

  await saveProducingRole(session, null);
  const ttl = writes[0].body as string;
  assert.deepEqual(objectsOf(ttl, WEBID, ORG_HAS_MEMBERSHIP), []);
  assert.deepEqual(objectsOf(ttl, MEMBERSHIP, ORG_ROLE), []);
  // Person data preserved.
  assert.deepEqual(objectsOf(ttl, WEBID, FOAF_NAME), ["Homer"]);
});

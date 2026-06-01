/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { Parser, Store } from "n3";
import type { Session } from "@inrupt/solid-client-authn-browser";
import {
  getOrganization,
  isSupportedLogoType,
  saveOrganization,
  uploadOrgLogo,
} from "./organizationManager.ts";

const WEBID = "https://pod.example/profile/card#me";
const PROFILE_DOC = "https://pod.example/profile/card";
const ORG = "https://pod.example/profile/card#org";

const ORG_MEMBER_OF = "http://www.w3.org/ns/org#memberOf";
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

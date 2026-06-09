/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Session } from "@inrupt/solid-client-authn-browser";
import { resolveAgent, resolveAgentOrgLogo } from "./agentResolver.ts";
import { _resetProfileCacheForTesting } from "../pod/profileDocument.ts";

const WEBID = "https://alice.example/profile/card#me";
const DOC = "https://alice.example/profile/card";

/** Fake offline session: serves the given Turtle for the profile doc URL, 404 else. */
function makeSession(profileTtl?: string): Session {
  const fetch = (input: string | URL): Promise<Response> => {
    const url = (typeof input === "string" ? input : input.toString()).split("?")[0];
    if (url === DOC && profileTtl !== undefined) {
      return Promise.resolve(
        new Response(profileTtl, {
          status: 200,
          headers: { "Content-Type": "text/turtle" },
        }),
      );
    }
    return Promise.resolve(new Response("Not found", { status: 404 }));
  };
  return {
    info: { webId: WEBID, isLoggedIn: true },
    fetch,
  } as unknown as Session;
}

Deno.test("resolveAgent reads foaf:name and foaf:img from the profile", async () => {
  _resetProfileCacheForTesting();
  const ttl = `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    <${WEBID}> a foaf:Person ;
      foaf:name "Alice Example" ;
      foaf:img <https://alice.example/avatar.png> .`;
  const agent = await resolveAgent(WEBID, makeSession(ttl));
  assert.equal(agent.webId, WEBID);
  assert.equal(agent.name, "Alice Example");
  assert.equal(agent.avatarUrl, "https://alice.example/avatar.png");
});

Deno.test("resolveAgent falls back to vcard:fn / vcard:hasPhoto", async () => {
  _resetProfileCacheForTesting();
  const ttl = `
    @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
    <${WEBID}> vcard:fn "Alice (vCard)" ;
      vcard:hasPhoto <https://alice.example/photo.jpg> .`;
  const agent = await resolveAgent(WEBID, makeSession(ttl));
  assert.equal(agent.name, "Alice (vCard)");
  assert.equal(agent.avatarUrl, "https://alice.example/photo.jpg");
});

Deno.test("resolveAgent falls back to the WebID fragment when the profile is unreachable", async () => {
  _resetProfileCacheForTesting();
  const agent = await resolveAgent(WEBID, makeSession(undefined));
  assert.equal(agent.webId, WEBID);
  assert.equal(agent.name, "me", "fragment after # is the fallback name");
  assert.equal(agent.avatarUrl, undefined);
});

Deno.test("resolveAgent prefers foaf:name over vcard:fn when both are present", async () => {
  _resetProfileCacheForTesting();
  const ttl = `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
    <${WEBID}> foaf:name "FOAF Name" ; vcard:fn "vCard Name" .`;
  const agent = await resolveAgent(WEBID, makeSession(ttl));
  assert.equal(agent.name, "FOAF Name");
});

Deno.test("resolveAgentOrgLogo follows org:memberOf → foaf:logo", async () => {
  _resetProfileCacheForTesting();
  const ttl = `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    @prefix org: <http://www.w3.org/ns/org#> .
    <${WEBID}> a foaf:Person ; org:memberOf <https://alice.example/profile/card#org> .
    <https://alice.example/profile/card#org> a org:Organization ;
      foaf:logo <https://alice.example/profile/logo.png> .`;
  const logo = await resolveAgentOrgLogo(WEBID, makeSession(ttl));
  assert.equal(logo, "https://alice.example/profile/logo.png");
});

Deno.test("resolveAgentOrgLogo returns null when there is no org or no logo", async () => {
  _resetProfileCacheForTesting();
  // No org membership at all.
  const noOrg = `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    <${WEBID}> a foaf:Person ; foaf:name "Alice" .`;
  assert.equal(await resolveAgentOrgLogo(WEBID, makeSession(noOrg)), null);

  // Org present but logo-less.
  _resetProfileCacheForTesting();
  const noLogo = `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    @prefix org: <http://www.w3.org/ns/org#> .
    <${WEBID}> org:memberOf <https://alice.example/profile/card#org> .
    <https://alice.example/profile/card#org> foaf:name "ACME" .`;
  assert.equal(await resolveAgentOrgLogo(WEBID, makeSession(noLogo)), null);
});

Deno.test("resolveAgentOrgLogo returns null for an unreachable profile", async () => {
  _resetProfileCacheForTesting();
  assert.equal(await resolveAgentOrgLogo(WEBID, makeSession(undefined)), null);
});

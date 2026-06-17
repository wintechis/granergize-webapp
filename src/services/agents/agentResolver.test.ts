import type { PodGateway } from "../pod/podGateway.ts";
/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { resolveAgent, resolveAgentOrg } from "./agentResolver.ts";
import { _resetProfileCacheForTesting } from "../pod/profileDocument.ts";
import { makeFakeSession } from "../testing/fakeSession.ts";

const WEBID = "https://alice.example/profile/card#me";
const DOC = "https://alice.example/profile/card";

/** Fake offline session: serves the given Turtle for the profile doc URL, 404 else. */
function makeSession(profileTtl?: string): PodGateway {
  return makeFakeSession({
    webId: WEBID,
    resources: profileTtl === undefined ? {} : { [DOC]: profileTtl },
  }).session;
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

Deno.test("resolveAgentOrg follows org:memberOf → foaf:name + foaf:logo", async () => {
  _resetProfileCacheForTesting();
  const ttl = `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    @prefix org: <http://www.w3.org/ns/org#> .
    <${WEBID}> a foaf:Person ; org:memberOf <https://alice.example/profile/card#org> .
    <https://alice.example/profile/card#org> a org:Organization ;
      foaf:name "Ahlmann Logistik" ;
      foaf:logo <https://alice.example/profile/logo.png> .`;
  const org = await resolveAgentOrg(WEBID, makeSession(ttl));
  assert.equal(org?.name, "Ahlmann Logistik");
  assert.equal(org?.logoUrl, "https://alice.example/profile/logo.png");
});

Deno.test("resolveAgentOrg returns null without an org, partial fields otherwise", async () => {
  _resetProfileCacheForTesting();
  // No org membership at all.
  const noOrg = `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    <${WEBID}> a foaf:Person ; foaf:name "Alice" .`;
  assert.equal(await resolveAgentOrg(WEBID, makeSession(noOrg)), null);

  // Org present but logo-less: the name still resolves.
  _resetProfileCacheForTesting();
  const noLogo = `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    @prefix org: <http://www.w3.org/ns/org#> .
    <${WEBID}> org:memberOf <https://alice.example/profile/card#org> .
    <https://alice.example/profile/card#org> foaf:name "ACME" .`;
  assert.deepEqual(await resolveAgentOrg(WEBID, makeSession(noLogo)), {
    name: "ACME",
  });
});

Deno.test("resolveAgentOrg returns null for an unreachable profile", async () => {
  _resetProfileCacheForTesting();
  assert.equal(await resolveAgentOrg(WEBID, makeSession(undefined)), null);
});

const COMMONS = "https://commons.wikimedia.org/wiki/Special:FilePath/";

/** A fake fetch serving canned Wikidata EntityData JSON; tracks calls. */
function fakeWikidataFetch(
  id: string,
  filename: string,
): typeof fetch & { called: boolean } {
  const fn = (() => {
    fn.called = true;
    return Promise.resolve(
      new Response(
        JSON.stringify({
          entities: {
            [id]: { claims: { P154: [{ mainsnak: { datavalue: { value: filename } } }] } },
          },
        }),
        { status: 200 },
      ),
    );
  }) as unknown as typeof fetch & { called: boolean };
  fn.called = false;
  return fn;
}

Deno.test("resolveAgentOrg falls back to owl:sameAs → Wikidata logo when no foaf:logo", async () => {
  _resetProfileCacheForTesting();
  const ttl = `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    @prefix org: <http://www.w3.org/ns/org#> .
    @prefix owl: <http://www.w3.org/2002/07/owl#> .
    <${WEBID}> org:memberOf <https://alice.example/profile/card#org> .
    <https://alice.example/profile/card#org> a org:Organization ;
      foaf:name "Ahlmann Logistik" ;
      owl:sameAs <https://www.wikidata.org/entity/Q123> .`;
  const fetchFn = fakeWikidataFetch("Q123", "Ahlmann logo.svg");
  const org = await resolveAgentOrg(WEBID, makeSession(ttl), fetchFn);
  assert.equal(org?.name, "Ahlmann Logistik");
  assert.equal(
    org?.logoUrl,
    `${COMMONS}${encodeURIComponent("Ahlmann logo.svg")}`,
  );
  assert.equal(fetchFn.called, true);
});

Deno.test("resolveAgentOrg prefers foaf:logo and does NOT hit Wikidata", async () => {
  _resetProfileCacheForTesting();
  const ttl = `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    @prefix org: <http://www.w3.org/ns/org#> .
    @prefix owl: <http://www.w3.org/2002/07/owl#> .
    <${WEBID}> org:memberOf <https://alice.example/profile/card#org> .
    <https://alice.example/profile/card#org>
      foaf:logo <https://alice.example/profile/logo.png> ;
      owl:sameAs <https://www.wikidata.org/entity/Q123> .`;
  const fetchFn = fakeWikidataFetch("Q123", "should-not-be-used.svg");
  const org = await resolveAgentOrg(WEBID, makeSession(ttl), fetchFn);
  assert.equal(org?.logoUrl, "https://alice.example/profile/logo.png");
  assert.equal(fetchFn.called, false, "foaf:logo wins, no Wikidata fetch");
});

Deno.test("resolveAgentOrg: owl:sameAs to a non-Wikidata IRI yields no logo", async () => {
  _resetProfileCacheForTesting();
  const ttl = `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    @prefix org: <http://www.w3.org/ns/org#> .
    @prefix owl: <http://www.w3.org/2002/07/owl#> .
    <${WEBID}> org:memberOf <https://alice.example/profile/card#org> .
    <https://alice.example/profile/card#org> a org:Organization ;
      foaf:name "ACME" ;
      owl:sameAs <https://example.org/companies/acme> .`;
  const fetchFn = fakeWikidataFetch("Q123", "unused.svg");
  const org = await resolveAgentOrg(WEBID, makeSession(ttl), fetchFn);
  assert.deepEqual(org, { name: "ACME" });
  assert.equal(fetchFn.called, false, "non-Wikidata sameAs triggers no fetch");
});

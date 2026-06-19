/// <reference lib="deno.ns" />
import type { PodGateway } from "../pod/podGateway.ts";
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
  assert.equal(org?.logoSource, "uploaded");
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
  assert.equal(org?.logoSource, "commons");
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

Deno.test("resolveAgent reads standard vCard/FOAF contact facts", async () => {
  _resetProfileCacheForTesting();
  const ttl = `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
    <${WEBID}> foaf:name "Alice Example" ;
      foaf:mbox <mailto:alice@example.com> ;
      foaf:homepage <https://alice.example/> ;
      vcard:hasTelephone "+49 111 222" ;
      vcard:hasAddress [ vcard:street-address "Main St 1" ;
                         vcard:postal-code "12345" ;
                         vcard:locality "Berlin" ;
                         vcard:country-name "Germany" ] .`;
  const agent = await resolveAgent(WEBID, makeSession(ttl));
  assert.equal(agent.address, "Main St 1, 12345 Berlin, Germany");
  assert.equal(agent.email, "alice@example.com"); // mailto: stripped
  assert.equal(agent.phone, "+49 111 222");
  assert.equal(agent.website, "https://alice.example/");
});

Deno.test("resolveAgent: MaStR wrapper predicates fall back to contact facts", async () => {
  _resetProfileCacheForTesting();
  // The MaStR `abr` document: standard vcard:hasAddress, but e-mail/phone/website
  // under the wrapper's own `…#Email/#Telefon/#Webseite` predicates.
  const ttl = `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    @prefix vcard: <http://www.w3.org/2006/vcard/ns#> .
    @prefix mastr: <https://wunderfacts.com/mastr/mastr#> .
    <${WEBID}> foaf:name "Raiffeisenbank Knoblauchsland eG" ;
      vcard:hasAddress [ vcard:street-address "Hofwiesenweg 9" ;
                         vcard:postal-code "90427" ;
                         vcard:locality "Nürnberg" ] ;
      mastr:Email "info@rb-knoblauchsland.de" ;
      mastr:Telefon "+49911934350" ;
      mastr:Webseite "www.rb-knoblauchsland.de" .`;
  const agent = await resolveAgent(WEBID, makeSession(ttl));
  assert.equal(agent.address, "Hofwiesenweg 9, 90427 Nürnberg");
  assert.equal(agent.email, "info@rb-knoblauchsland.de");
  assert.equal(agent.phone, "+49911934350");
  assert.equal(agent.website, "www.rb-knoblauchsland.de");
});

Deno.test("resolveAgent: no contact facts → fields absent", async () => {
  _resetProfileCacheForTesting();
  const ttl = `
    @prefix foaf: <http://xmlns.com/foaf/0.1/> .
    <${WEBID}> foaf:name "Spartan" .`;
  const agent = await resolveAgent(WEBID, makeSession(ttl));
  assert.equal(agent.address, undefined);
  assert.equal(agent.email, undefined);
  assert.equal(agent.phone, undefined);
  assert.equal(agent.website, undefined);
});

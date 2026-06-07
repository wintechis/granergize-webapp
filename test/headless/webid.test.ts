/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { profileAuthorizesIssuer, verifyWebId } from "./webid.ts";

const WEBID = "http://localhost:3456/alice/profile/card#me";
const DOC = "http://localhost:3456/alice/profile/card";
const ISSUER = "http://localhost:3456";

const profile = (issuer: string | null) =>
  `@prefix solid: <http://www.w3.org/ns/solid/terms#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .
<#me> a foaf:Agent${issuer ? ` ;\n  solid:oidcIssuer <${issuer}>` : ""} .
`;

Deno.test("profileAuthorizesIssuer: true when the profile lists the issuer", () => {
  assert.equal(profileAuthorizesIssuer(profile(ISSUER), WEBID, ISSUER, DOC), true);
});

Deno.test("profileAuthorizesIssuer: trailing slash is ignored on both sides", () => {
  assert.equal(profileAuthorizesIssuer(profile(`${ISSUER}/`), WEBID, ISSUER, DOC), true);
  assert.equal(profileAuthorizesIssuer(profile(ISSUER), WEBID, `${ISSUER}/`, DOC), true);
});

Deno.test("profileAuthorizesIssuer: false when oidcIssuer is absent or different", () => {
  assert.equal(profileAuthorizesIssuer(profile(null), WEBID, ISSUER, DOC), false);
  assert.equal(
    profileAuthorizesIssuer(profile("https://evil.example"), WEBID, ISSUER, DOC),
    false,
  );
});

Deno.test("verifyWebId: resolves when the dereferenced profile authorizes the issuer", async () => {
  const fetchFn: typeof fetch = () => Promise.resolve(new Response(profile(ISSUER)));
  await verifyWebId(WEBID, ISSUER, fetchFn); // must not throw
});

Deno.test("verifyWebId: throws when the profile omits the issuer (spoofing guard)", async () => {
  const fetchFn: typeof fetch = () => Promise.resolve(new Response(profile(null)));
  await assert.rejects(() => verifyWebId(WEBID, ISSUER, fetchFn), /does not assert solid:oidcIssuer/);
});

Deno.test("verifyWebId: throws when the profile is unreadable", async () => {
  const fetchFn: typeof fetch = () => Promise.resolve(new Response("", { status: 404 }));
  await assert.rejects(() => verifyWebId(WEBID, ISSUER, fetchFn), /not readable \(HTTP 404\)/);
});

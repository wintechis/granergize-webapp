/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { diagnoseLoginFailure, discoveryUrl } from "./diagnoseLoginFailure.ts";

const ISSUER = "https://solidtest.iis.fraunhofer.de/";

Deno.test("discoveryUrl: one slash regardless of the issuer's trailing form", () => {
  assert.equal(
    discoveryUrl("https://idp.example/"),
    "https://idp.example/.well-known/openid-configuration",
  );
  assert.equal(
    discoveryUrl("https://idp.example"),
    "https://idp.example/.well-known/openid-configuration",
  );
  assert.equal(
    discoveryUrl("https://idp.example///"),
    "https://idp.example/.well-known/openid-configuration",
  );
});

Deno.test("recovers the HTTP status a reachable-but-erroring provider returns (503)", async () => {
  const fetchFn = ((url: string) => {
    assert.equal(url, `${ISSUER}.well-known/openid-configuration`);
    return Promise.resolve(
      new Response("", { status: 503, statusText: "Service Unavailable" }),
    );
  }) as unknown as typeof fetch;
  const detail = await diagnoseLoginFailure(
    ISSUER,
    new TypeError("NetworkError when attempting to fetch resource."),
    fetchFn,
  );
  assert.match(detail, /HTTP 503 Service Unavailable/);
  assert.match(detail, /openid-configuration/);
});

Deno.test("a 404 (not a Solid provider) surfaces its code too", async () => {
  const fetchFn = (() =>
    Promise.resolve(
      new Response("", { status: 404, statusText: "Not Found" }),
    )) as unknown as typeof fetch;
  const detail = await diagnoseLoginFailure(ISSUER, new Error("x"), fetchFn);
  assert.match(detail, /HTTP 404 Not Found/);
});

Deno.test("an unreachable provider (probe also throws) → a clear reason, not raw NetworkError", async () => {
  const fetchFn = (() =>
    Promise.reject(
      new TypeError("NetworkError when attempting to fetch resource."),
    )) as unknown as typeof fetch;
  const detail = await diagnoseLoginFailure(ISSUER, new Error("x"), fetchFn);
  assert.match(detail, /Couldn.t reach solidtest\.iis\.fraunhofer\.de/);
  assert.match(detail, /offline|CORS/);
});

Deno.test("discovery is fine → the original login error is kept (failure lies further along)", async () => {
  const fetchFn = (() =>
    Promise.resolve(
      new Response("{}", { status: 200 }),
    )) as unknown as typeof fetch;
  const detail = await diagnoseLoginFailure(
    ISSUER,
    new Error("client registration rejected"),
    fetchFn,
  );
  assert.equal(detail, "client registration rejected");
});

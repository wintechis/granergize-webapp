/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { CF_1015_SENTINEL, isCloudflare1015 } from "./cloudflare1015.ts";

// A real Cloudflare 1015 page (trimmed); the literals the detector keys on.
const CF_1015_BODY =
  "<!DOCTYPE html><html><head><title>solidcommunity.net | 429: Too many requests" +
  "</title></head><body><h1>Error 1015 Ray ID: abc</h1>" +
  "<h2>You are being rate limited</h2>" +
  "<p>error code: 1015</p></body></html>";

const CF_EDGE_HEADERS = { "server": "cloudflare", "cf-ray": "abc-FRA" };

Deno.test("isCloudflare1015: matches the 1015 page body on a 429", () => {
  assert.equal(isCloudflare1015(429, CF_EDGE_HEADERS, CF_1015_BODY), true);
});

Deno.test("isCloudflare1015: matches on a 503 too (Cloudflare also uses it)", () => {
  assert.equal(isCloudflare1015(503, CF_EDGE_HEADERS, CF_1015_BODY), true);
});

Deno.test("isCloudflare1015: a normal CSS 429 WITH CORS is not a match", () => {
  // The origin (CSS) serving its own 429 includes a CORS header and no 1015 body;
  // that's retryFetch's job, not a run-abort.
  const headers = {
    "server": "cloudflare",
    "cf-ray": "abc-FRA",
    "access-control-allow-origin": "*",
  };
  const body = '{"error":"too many requests"}';
  assert.equal(isCloudflare1015(429, headers, body), false);
});

Deno.test("isCloudflare1015: opaque 429 (null body) — falls back to edge+no-CORS shape", () => {
  // Cross-origin block the browser hid from JS: body unreadable, but it's a
  // Cloudflare-edge 429 with no CORS header — the 1015 fingerprint.
  assert.equal(isCloudflare1015(429, CF_EDGE_HEADERS, null), true);
});

Deno.test("isCloudflare1015: opaque 429 WITH CORS (null body) is not a match", () => {
  const headers = { ...CF_EDGE_HEADERS, "access-control-allow-origin": "*" };
  assert.equal(isCloudflare1015(429, headers, null), false);
});

Deno.test("isCloudflare1015: opaque 429 from a non-Cloudflare origin is not a match", () => {
  assert.equal(isCloudflare1015(429, { "server": "nginx" }, null), false);
});

Deno.test("isCloudflare1015: a successful response is never a match", () => {
  assert.equal(isCloudflare1015(200, CF_EDGE_HEADERS, "ok"), false);
});

Deno.test("isCloudflare1015: a non-throttle error (500) is never a match", () => {
  assert.equal(isCloudflare1015(500, CF_EDGE_HEADERS, "boom error code: 1015"), false);
});

Deno.test("CF_1015_SENTINEL is a stable, greppable marker", () => {
  assert.equal(CF_1015_SENTINEL, "##CLOUDFLARE_1015_ABORT##");
});

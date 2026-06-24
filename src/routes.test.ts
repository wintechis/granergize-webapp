/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  aggregationRoute,
  agentRoute,
  buildingRoute,
  DETAIL_PATTERNS,
  FINDERS,
  observationRoute,
  roomRoute,
} from "./routes.ts";

Deno.test("a relative (own) id rides in ?ref=, percent-encoded", () => {
  // Own ids carry '/' and '#' (e.g. `granergize/buildings/<uuid>.ttl#it`) — they
  // must be percent-encoded so a raw '#'/'?' can't truncate the query value.
  const id = "granergize/buildings/abc.ttl#it";
  assert.equal(
    buildingRoute(id),
    "/building?ref=granergize%2Fbuildings%2Fabc.ttl%23it",
  );
  assert.equal(
    observationRoute("2024/06/13/xyz"),
    "/observation?ref=2024%2F06%2F13%2Fxyz",
  );
  assert.equal(aggregationRoute("v1"), "/aggregation?ref=v1");
});

Deno.test("an absolute (foreign) id rides in ?uri=, percent-encoded", () => {
  assert.equal(
    buildingRoute("https://bob.example/buildings/x.ttl#it"),
    "/building?uri=https%3A%2F%2Fbob.example%2Fbuildings%2Fx.ttl%23it",
  );
  assert.equal(
    roomRoute("https://pod.example/r#it"),
    "/room?uri=https%3A%2F%2Fpod.example%2Fr%23it",
  );
});

Deno.test("agent builder always uses ?uri= (a WebID is absolute)", () => {
  assert.equal(
    agentRoute("https://bob.example/profile/card#me"),
    "/agent?uri=https%3A%2F%2Fbob.example%2Fprofile%2Fcard%23me",
  );
});

Deno.test("a builder output matches its bare detail pattern", () => {
  // The builder prefixes the declared bare path, then the query param — guards
  // the two from drifting apart.
  assert.equal(DETAIL_PATTERNS.building, "/building");
  assert.equal(buildingRoute("x").startsWith("/building?ref="), true);
  assert.equal(FINDERS.observations, "/observations");
});

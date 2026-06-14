/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  aggregationRoute,
  buildingRoute,
  contactRoute,
  DETAIL_PATTERNS,
  FINDERS,
  observationRoute,
  roomRoute,
} from "./routes.ts";

Deno.test("route builders encode the param into one segment", () => {
  // Own ids carry '/' and '#' (e.g. `granergize/buildings/<uuid>.ttl#it`) — they
  // must be percent-encoded so a raw '#'/'?' can't truncate the path.
  const id = "granergize/buildings/abc.ttl#it";
  assert.equal(
    buildingRoute(id),
    "/building/granergize%2Fbuildings%2Fabc.ttl%23it",
  );
  assert.equal(
    observationRoute("2024/06/13/xyz"),
    "/observation/2024%2F06%2F13%2Fxyz",
  );
  assert.equal(aggregationRoute("v1"), "/aggregation/v1");
  assert.equal(
    roomRoute("https://pod.example/r#it"),
    "/room/https%3A%2F%2Fpod.example%2Fr%23it",
  );
});

Deno.test("contact builder encodes an absolute WebID", () => {
  assert.equal(
    contactRoute("https://bob.example/profile/card#me"),
    "/contact/https%3A%2F%2Fbob.example%2Fprofile%2Fcard%23me",
  );
});

Deno.test("a builder output matches its detail pattern shape", () => {
  // The builder fills the `:id` slot of the declared pattern (one segment after
  // the literal prefix) — guards the two from drifting apart.
  assert.equal(DETAIL_PATTERNS.building, "/building/:id");
  assert.equal(buildingRoute("x").startsWith("/building/"), true);
  assert.equal(buildingRoute("x").split("/").length, 3);
  assert.equal(FINDERS.observations, "/observations");
});

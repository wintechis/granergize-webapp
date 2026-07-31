/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import {
  aggregationRoute,
  agentRoute,
  ALIASES,
  backTarget,
  buildingRoute,
  DETAIL_PATTERNS,
  FINDERS,
  observationRoute,
  observationUnitRoute,
  pushTrail,
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

// Drift guard: index.html's runtime base-href detection enumerates the first path
// segment of every app route in a hand-written KNOWN_ROUTE_SEGMENTS list (it can't
// import routes.ts — it runs before the bundle). If that list misses a route segment,
// a deep link / reload on that route mis-detects the app base (basename = the segment,
// assets 404, redirect to home) — a silent break TypeScript can't catch, only e2e.
// This asserts the list exactly equals the route table, so a rename/addition that
// forgets index.html fails the unit suite instead.
Deno.test("index.html KNOWN_ROUTE_SEGMENTS exactly mirrors the route table", async () => {
  const html = await Deno.readTextFile(new URL("../index.html", import.meta.url));
  const block = html.match(/KNOWN_ROUTE_SEGMENTS\s*=\s*\[([^\]]*)\]/);
  assert.ok(block, "KNOWN_ROUTE_SEGMENTS array not found in index.html");
  const listed = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();

  // The first path segment of every finder + detail + alias route (HOME "/" has none);
  // an alias is a real served path, so a deep link to it must detect the base too.
  const firstSegment = (p: string) => p.replace(/^\//, "").split("/")[0];
  const expected = [
    ...new Set(
      [
        ...Object.values(FINDERS),
        ...Object.values(DETAIL_PATTERNS),
        ...Object.values(ALIASES),
      ]
        .map(firstSegment)
        .filter((s) => s.length > 0),
    ),
  ].sort();

  assert.deepEqual(
    listed,
    expected,
    "index.html KNOWN_ROUTE_SEGMENTS is out of sync with routes.ts (FINDERS + DETAIL_PATTERNS + ALIASES)",
  );
});

Deno.test("pushTrail records the referrer only when entering a detail page", () => {
  // agents finder → agent detail: the agents location joins the trail.
  assert.deepEqual(
    pushTrail([], "/agents", agentRoute("https://x/#me")),
    ["/agents"],
  );
  // agent → building: the chain grows (back will walk agent then agents).
  assert.deepEqual(
    pushTrail(["/agents"], "/agent?uri=https%3A%2F%2Fx%2F%23me", buildingRoute("v1")),
    ["/agents", "/agent?uri=https%3A%2F%2Fx%2F%23me"],
  );
  // A non-detail target (a finder) carries no back affordance → trail unchanged.
  assert.deepEqual(pushTrail(["/agents"], "/agent?uri=x", FINDERS.buildings), ["/agents"]);
});

Deno.test("backTarget pops the newest trail entry, else the fallback finder", () => {
  assert.equal(
    backTarget(["/agents", "/agent?uri=x"], FINDERS.buildings),
    "/agent?uri=x",
  );
  // No trail (deep link / fresh tab / shared URL) → the page's fallback finder.
  assert.equal(backTarget([], FINDERS.buildings), "/buildings");
  assert.equal(backTarget(undefined, FINDERS.agents), "/agents");
});

Deno.test("a builder output matches its bare detail pattern", () => {
  // The builder prefixes the declared bare path, then the query param — guards
  // the two from drifting apart.
  assert.equal(DETAIL_PATTERNS.building, "/building");
  assert.equal(buildingRoute("x").startsWith("/building?ref="), true);
  assert.equal(FINDERS.observations, "/observations");
});

Deno.test("observationUnitRoute appends the ?unit= focus param", () => {
  assert.equal(
    observationUnitRoute("b1", "sys-abc123"),
    "/observation?ref=b1&unit=sys-abc123",
  );
  // Composes with an absolute id's ?uri= form too.
  assert.equal(
    observationUnitRoute("https://bob.example/b.ttl#it", "sys-x"),
    "/observation?uri=https%3A%2F%2Fbob.example%2Fb.ttl%23it&unit=sys-x",
  );
});

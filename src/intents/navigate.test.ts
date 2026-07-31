/// <reference lib="deno.ns" />
//
// Tier-1 for the navigate arm (plan-intent-core §7): goTo resolves a catalog
// navigate name + params to a route string (pure, no gateway), and every navigate
// catalog entry has a core. Route encoding itself is owned by routes.ts.
import { strict as assert } from "node:assert";
import { goTo, NAVIGATE_CORES, NotNavigableError } from "./navigate.ts";
import { INTENTS } from "./catalog.ts";
import { AGGREGATIONS_VIEW, FINDERS, HOME } from "../routes.ts";

Deno.test("goTo: collection verbs resolve to finder routes (no params)", () => {
  assert.equal(goTo("ShowDashboard"), HOME);
  assert.equal(goTo("ShowBuildings"), FINDERS.buildings);
  // Saved views are a PROJECTION of Explore now (Step 2 of the cube-centered
  // plan) — the verb navigates straight there, not via the /aggregations redirect.
  assert.equal(goTo("ShowAggregations"), AGGREGATIONS_VIEW);
  assert.equal(AGGREGATIONS_VIEW, "/observations?view=aggregations");
  assert.equal(goTo("ShowAgents"), FINDERS.agents);
});

Deno.test("goTo: detail verbs encode the id (own → ?ref=, absolute → ?uri=)", () => {
  assert.match(goTo("ShowBuilding", { id: "buildings/abc.ttl#it" }), /\/building\?ref=/);
  assert.match(goTo("ShowBuilding", { id: "https://bob.example/b#it" }), /\/building\?uri=/);
  assert.match(goTo("ShowRoom", { uri: "https://a.example/rooms/r1/" }), /\/room\?uri=/);
});

Deno.test("goTo: an unknown name throws NotNavigableError", () => {
  assert.throws(() => goTo("Nope"), NotNavigableError);
});

Deno.test("every navigate catalog entry has a NAVIGATE_CORES core", () => {
  const navKeys = new Set(Object.keys(NAVIGATE_CORES));
  const navIntents = INTENTS.filter((e) => e.effect === "navigate");
  assert.ok(navIntents.length >= 7, "expected the collection + detail navigate verbs");
  for (const e of navIntents) {
    assert.ok(navKeys.has(e.name), `navigate intent ${e.name} lacks a core`);
  }
});

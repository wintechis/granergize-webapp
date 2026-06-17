/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { filterByText, matchesQuery } from "./textSearch.ts";

Deno.test("matchesQuery: empty/whitespace query matches everything", () => {
  assert.equal(matchesQuery("anything", ""), true);
  assert.equal(matchesQuery("anything", "   "), true);
});

Deno.test("matchesQuery: case-insensitive substring", () => {
  assert.equal(matchesQuery("Raiffeisenbank Knoblauchsland", "knobl"), true);
  assert.equal(matchesQuery("Raiffeisenbank", "spar"), false);
});

Deno.test("matchesQuery: all whitespace-separated terms must match (AND)", () => {
  assert.equal(matchesQuery("Hofwiesenweg 9, Nürnberg", "hof nürnberg"), true);
  assert.equal(matchesQuery("Hofwiesenweg 9, Nürnberg", "hof berlin"), false);
});

Deno.test("filterByText: filters via the accessor; empty query returns all", () => {
  const items = [
    { name: "Alpha", city: "Berlin" },
    { name: "Beta", city: "Nürnberg" },
    { name: "Gamma", city: "Berlin" },
  ];
  const text = (i: typeof items[number]) => `${i.name} ${i.city}`;

  assert.deepEqual(filterByText(items, "", text), items);
  assert.deepEqual(
    filterByText(items, "berlin", text).map((i) => i.name),
    ["Alpha", "Gamma"],
  );
  assert.deepEqual(
    filterByText(items, "beta nürn", text).map((i) => i.name),
    ["Beta"],
  );
  assert.deepEqual(filterByText(items, "delta", text), []);
});

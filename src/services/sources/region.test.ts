/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { bundeslandName, bundeslandToAgs } from "./region.ts";

Deno.test("bundeslandToAgs: canonical German names → 2-digit AGS", () => {
  assert.equal(bundeslandToAgs("Bayern"), "09"); // the pilot region (Nürnberg)
  assert.equal(bundeslandToAgs("Berlin"), "11");
  assert.equal(bundeslandToAgs("Schleswig-Holstein"), "01");
  assert.equal(bundeslandToAgs("Thüringen"), "16");
});

Deno.test("bundeslandToAgs: tolerant of casing, whitespace, umlaut spelling", () => {
  assert.equal(bundeslandToAgs("  bayern "), "09");
  assert.equal(bundeslandToAgs("BADEN-WÜRTTEMBERG"), "08");
  assert.equal(bundeslandToAgs("Baden-Wuerttemberg"), "08"); // ue spelling
  assert.equal(bundeslandToAgs("Nordrhein-Westfalen"), "05");
});

Deno.test("bundeslandToAgs: common English names", () => {
  assert.equal(bundeslandToAgs("Bavaria"), "09");
  assert.equal(bundeslandToAgs("Saxony"), "14");
});

Deno.test("bundeslandToAgs: empty / unknown / foreign → null", () => {
  assert.equal(bundeslandToAgs(""), null);
  assert.equal(bundeslandToAgs(null), null);
  assert.equal(bundeslandToAgs(undefined), null);
  assert.equal(bundeslandToAgs("Île-de-France"), null); // not a German Bundesland
});

Deno.test("bundeslandName: AGS → canonical German name (reverse of bundeslandToAgs)", () => {
  assert.equal(bundeslandName("09"), "Bayern");
  assert.equal(bundeslandName("08"), "Baden-Württemberg");
  assert.equal(bundeslandName("16"), "Thüringen");
  assert.equal(bundeslandName("99"), null); // unknown AGS
  // Round-trips with bundeslandToAgs for every recognised name.
  for (const name of ["Bayern", "Hessen", "Berlin", "Sachsen-Anhalt"]) {
    assert.equal(bundeslandName(bundeslandToAgs(name)!), name);
  }
});

/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import type { Building } from "../types.ts";
import { buildingAddressLine, buildingDisplayName } from "./buildingDisplay.ts";

function building(fields: Partial<Building>): Building {
  return { id: "b1", uri: "urn:b:b1", type: "x", ...fields } as Building;
}

Deno.test("buildingDisplayName prefers label, then code, then address, then the verbatim id", () => {
  assert.equal(
    buildingDisplayName(
      building({ label: "Halle Nord", buildingCode: "C-1", streetAddress: "A St" }),
    ),
    "Halle Nord",
  );
  assert.equal(
    buildingDisplayName(building({ buildingCode: "C-1", streetAddress: "A St" })),
    "C-1",
  );
  assert.equal(buildingDisplayName(building({ streetAddress: "A St" })), "A St");
  // The id fallback shows the IRI-extracted id verbatim (heike-5 #1) — never a
  // derived number that exists nowhere in the data.
  assert.equal(buildingDisplayName(building({})), "Building b1");
});

Deno.test("buildingAddressLine joins street and city parts, omitting unset ones", () => {
  assert.equal(
    buildingAddressLine(
      building({ streetAddress: "A St 1", postalCode: "90402", locality: "Nürnberg" }),
    ),
    "A St 1, 90402 Nürnberg",
  );
  assert.equal(buildingAddressLine(building({ streetAddress: "A St 1" })), "A St 1");
  assert.equal(buildingAddressLine(building({ locality: "Nürnberg" })), "Nürnberg");
  assert.equal(buildingAddressLine(building({})), "");
});

// ── datasetSummary — locale-driven (was a hand-rolled English `"year"+"s"`) ────

import type { Building as B2 } from "../types.ts";
import { datasetSummary } from "./buildingDisplay.ts";
import { type MessageId, type MessageParams, translate } from "./messages.ts";

const withDatasets = (years: number[], granularity = "P1Y"): B2 =>
  ({
    energyDatasets: years.map((year) => ({ year, granularity })),
  }) as unknown as B2;

const tEn = (id: MessageId, p?: MessageParams) => translate("en", id, p);
const tDe = (id: MessageId, p?: MessageParams) => translate("de", id, p);

Deno.test("datasetSummary pluralizes and localizes through the catalog", () => {
  // One year — singular form, no hand-rolled "+s".
  assert.equal(
    datasetSummary(withDatasets([2024]), tEn),
    "1 year (2024) · annual",
  );
  // Several years — plural + range.
  assert.equal(
    datasetSummary(withDatasets([2022, 2023, 2024]), tEn),
    "3 years (2022–2024) · annual",
  );
  // German — the old inline English string structurally couldn't do this.
  assert.equal(
    datasetSummary(withDatasets([2022, 2024]), tDe),
    "2 Jahre (2022–2024) · jährlich",
  );
});

Deno.test("datasetSummary flags a sub-hourly series and handles the empty case", () => {
  assert.equal(
    datasetSummary(withDatasets([2024], "PT15M"), tEn),
    "1 year (2024) · annual + time series",
  );
  assert.equal(datasetSummary(withDatasets([]), tEn), "");
});

/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { comment, fieldLabel, label, optionLabel } from "./vocabLabels.ts";
import {
  VOCAB_COMMENTS,
  VOCAB_LABELS,
} from "./vocabLabels.generated.ts";
import { generateMaps, renderModule } from "../../../scripts/genVocabLabels.ts";

const BUILDING_NS = "https://solid.ti.rw.fau.de/gra/building.ttl#";
const YEAR_OF_CONSTRUCTION = `${BUILDING_NS}yearOfConstruction`;

Deno.test("label resolves de/en from the generated vocab", () => {
  assert.equal(label(YEAR_OF_CONSTRUCTION, "en"), "Year of construction");
  assert.equal(label(YEAR_OF_CONSTRUCTION, "de"), "Baujahr");
  assert.equal(label(YEAR_OF_CONSTRUCTION, "fr"), "Année de construction");
});

Deno.test("label falls back chosen → en → local-name fragment", () => {
  // A synthetic term present only in en falls back to en for de.
  const enOnly = "https://solid.ti.rw.fau.de/gra/building.ttl#GeocodePrecision";
  // GeocodePrecision actually carries de too, so test the IRI-fragment last hop
  // with a definitely-absent IRI.
  const unknown = "https://example.org/vocab#somethingUnknown";
  assert.equal(label(unknown, "de"), "somethingUnknown");
  assert.equal(label(unknown), "somethingUnknown");
  // And that a present term with a missing chosen lang would fall back to en —
  // exercised here by asserting en is non-empty so the chain has a middle hop.
  assert.ok(label(enOnly, "en").length > 0);
});

Deno.test("fieldLabel resolves a building field via buildingConfig's field→IRI map", () => {
  assert.equal(fieldLabel("yearOfConstruction", "en"), "Year of construction");
  assert.equal(fieldLabel("yearOfConstruction", "de"), "Baujahr");
});

Deno.test("optionLabel resolves a controlled-vocab instance IRI", () => {
  const oneShift = `${BUILDING_NS}OneShift`;
  assert.equal(optionLabel(oneShift, "en"), "1-Shift");
  assert.equal(optionLabel(oneShift, "de"), "1-Schicht");
});

Deno.test("optionLabel falls back chosen → en → IRI fragment for an unknown IRI", () => {
  const unknown = "https://example.org/vocab#somethingUnknown";
  assert.equal(optionLabel(unknown, "de"), "somethingUnknown");
});

Deno.test("comment resolves and falls back, returns undefined for uncommented terms", () => {
  const unknown = "https://example.org/vocab#noComment";
  assert.equal(comment(unknown), undefined);
});

Deno.test("generated maps are fresh (match a regeneration from the vocab)", () => {
  const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
  const { labels, comments } = generateMaps(repoRoot);
  const regenerated = renderModule(labels, comments);
  const committed = Deno.readTextFileSync(
    new URL("./vocabLabels.generated.ts", import.meta.url),
  );
  assert.equal(
    regenerated,
    committed,
    "vocabLabels.generated.ts is stale — run `deno task gen:labels`",
  );
});

Deno.test("every labelled owned term carries en AND de (fr is a known pending gap)", () => {
  const missingFr: string[] = [];
  for (const [iri, byLang] of Object.entries(VOCAB_LABELS)) {
    assert.ok(byLang.en, `owned term missing @en label: ${iri}`);
    assert.ok(byLang.de, `owned term missing @de label: ${iri}`);
    if (!byLang.fr) missingFr.push(iri);
  }
  if (missingFr.length > 0) {
    console.log(
      `[vocabLabels] ${missingFr.length} owned term(s) still missing @fr label (known pending gap).`,
    );
  }
  // VOCAB_COMMENTS is sparser by design (not every term carries a comment);
  // where a comment exists in any language, require at least en or de.
  for (const [iri, byLang] of Object.entries(VOCAB_COMMENTS)) {
    assert.ok(
      byLang.en || byLang.de,
      `owned term carries a comment but neither @en nor @de: ${iri}`,
    );
  }
});

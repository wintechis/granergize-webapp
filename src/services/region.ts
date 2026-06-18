/**
 * Resolve a building to its German region code for the regional-statistics layer
 * (`linked-regionalstatistik`, an RDF Data Cube keyed by AGS — see
 * `rdf/regionalCube.ts`). AGS is hierarchical: the 2-digit prefix is the
 * Bundesland, the 5-digit code the Kreis. The MVP joins at **Bundesland** grain
 * from the building's existing `region` field (vcard:region, a Bundesland name) —
 * no geocoding service needed. A lat/long → Kreis (5-digit) resolver against a
 * linked geo wrapper is the later step that unlocks Kreis-level tables.
 *
 * Pure + offline: a static 16-entry name→code map, tolerant of casing, the
 * ü/ä/ö ↔ ue/ae/oe spellings, and the common English names.
 */

/** Bundesland AGS (2-digit `ags/NN`) keyed by a normalised name. */
const BUNDESLAND_AGS: Record<string, string> = {
  "schleswig-holstein": "01",
  "hamburg": "02",
  "niedersachsen": "03",
  "lower-saxony": "03",
  "bremen": "04",
  "nordrhein-westfalen": "05",
  "north-rhine-westphalia": "05",
  "nrw": "05",
  "hessen": "06",
  "hesse": "06",
  "rheinland-pfalz": "07",
  "rhineland-palatinate": "07",
  "baden-wuerttemberg": "08",
  "badenwuerttemberg": "08",
  "bayern": "09",
  "bavaria": "09",
  "saarland": "10",
  "berlin": "11",
  "brandenburg": "12",
  "mecklenburg-vorpommern": "13",
  "sachsen": "14",
  "saxony": "14",
  "sachsen-anhalt": "15",
  "saxony-anhalt": "15",
  "thueringen": "16",
  "thuringia": "16",
};

/** Lowercase, transliterate umlauts/ß, collapse whitespace/underscores to hyphens. */
function normalise(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[\s_]+/g, "-");
}

/**
 * The 2-digit Bundesland AGS for a building's `region` (vcard:region) name, or
 * `null` when it is empty / not a recognised German Bundesland (e.g. a foreign
 * building). The regional cube's `ags/NN` geo dimension keys on exactly this.
 */
export function bundeslandToAgs(region: string | null | undefined): string | null {
  if (!region) return null;
  return BUNDESLAND_AGS[normalise(region)] ?? null;
}

/** Canonical German Bundesland name keyed by its 2-digit AGS — the reverse of
 *  {@link bundeslandToAgs}, used to title a region when only its AGS is in hand
 *  (e.g. the open-data regional dataset page, which holds only `table` + `ags`). */
const BUNDESLAND_NAME: Record<string, string> = {
  "01": "Schleswig-Holstein",
  "02": "Hamburg",
  "03": "Niedersachsen",
  "04": "Bremen",
  "05": "Nordrhein-Westfalen",
  "06": "Hessen",
  "07": "Rheinland-Pfalz",
  "08": "Baden-Württemberg",
  "09": "Bayern",
  "10": "Saarland",
  "11": "Berlin",
  "12": "Brandenburg",
  "13": "Mecklenburg-Vorpommern",
  "14": "Sachsen",
  "15": "Sachsen-Anhalt",
  "16": "Thüringen",
};

/** The canonical Bundesland name for a 2-digit AGS, or `null` if unrecognised. */
export function bundeslandName(ags: string): string | null {
  return BUNDESLAND_NAME[ags] ?? null;
}

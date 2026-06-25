# Wikidata ↔ our model

**Wikidata** (`www.wikidata.org`) is consulted in
`src/services/agents/agentResolver.ts` / `wikidataLogo.ts` to resolve an
organisation's logo when its Pod profile has no `foaf:logo` but links to a
Wikidata entity via `owl:sameAs`. Wikidata is RDF-native, but the app uses it as
a **plain JSON API** (no SPARQL, no triples ingested), so it sits at the edge of
the vocabulary frame — its own source id.

## What it is

`GET /wiki/Special:EntityData/{Qid}.json` → the entity's `claims`. The app reads
**P154** (logo image), falling back to **P18** (image), and extracts the
Wikimedia Commons **filename** string. It never ingests Wikidata as Linked Data;
it walks the JSON claims for one value. Errors are swallowed (the logo is
optional).

## Relation to our model

Identity enrichment, not observation/place data: it turns an org's `owl:sameAs`
Wikidata link into a logo reference. It writes nothing to the Pod — the building's
producer org and its `foaf:logo`/`prov:agent` stay the source of truth; Wikidata
is only a fallback image lookup. The resolved filename is handed to `commons.md`
for the actual bytes.

## Provenance

Wikidata statements are **CC0**, but the referenced images are not (see
`commons.md`). When an org adopts its Wikidata logo on save, the persisted
`foaf:logo` records `prov:wasDerivedFrom`/`dcterms:source` the Wikidata entity, so
the derivation is traceable from the profile Turtle. The image licence itself is
per-file on Commons (`commons.md`); Wikidata's CC0 claim data needs no
attribution.

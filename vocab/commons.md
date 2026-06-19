# Wikimedia Commons ↔ our model

**Wikimedia Commons** (`commons.wikimedia.org`) supplies the actual logo image
bytes for the Wikidata fallback (`src/services/agents/wikidataLogo.ts`). A plain
HTTP file service — **not RDF** — its own source id, downstream of `wikidata.md`.

## What it is

`GET /wiki/Special:FilePath/{filename}` — a 302 redirect to the real image URL
(PNG/SVG/…). The app builds this URL from the Commons filename Wikidata returned
and uses it directly as an `<img src>` (the redirect avoids a CORS preflight). No
metadata is parsed; only the image is fetched, by the browser, at render time.

## Relation to our model

Pure presentation asset for an org marker/hover card — nothing is stored on the
Pod, no entities or IRIs of our own. It is the last hop of the
`owl:sameAs → Wikidata → Commons` logo chain; if any hop fails the app simply
shows no logo.

## Provenance

Commons files carry **per-file licences** (CC0 / CC BY / CC BY-SA / public
domain), not a single blanket licence. Provenance is now recorded in the Turtle:
when an org is saved (`saveOrganization`) with a Wikidata `owl:sameAs` and no logo
of its own, the resolved Commons logo is persisted as `foaf:logo <commons-url>`
with `<commons-url> a prov:Entity ; prov:wasDerivedFrom <wikidata-entity> ;
dcterms:source <wikidata-entity>` — so the origin travels with the profile, and
the marker no longer re-resolves Wikidata each render. An uploaded `foaf:logo`
(known rights) is always preserved over this fallback. Still open: the **per-file
licence IRI** isn't captured (it lives on the Commons file page, reachable from
the URL but not fetched), and the attribution isn't surfaced in the rendered UI.

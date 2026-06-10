# Granergize vocabularies — repo is the source of truth

The app models Pod data with three Granergize vocabularies, partitioned by
subject (not by stakeholder — see `notes/plan-vocab-consolidation.md`). Their
IRIs are absolute URLs on the FAU Solid Pod, but **the editable source of truth
is these files in the repo** — the published documents are a deploy target, not
the master copy. The app itself only *references* these IRIs (as constants in
`src/services/rdf/vocabularies.ts`); it never fetches these documents at runtime.

## Namespace → file

- `BUILDING_NS` — `https://solid.ti.rw.fau.de/gra/building.ttl#` →
  `vocab/building.ttl`. A RealEstateCore extension profile: all building
  master data (areas, years, heating flags, controlled vocabularies, operating
  costs, certifications, attachments, geocode precision, the `investor` agent
  link). Terms are minted here and aligned to REC 4 / Brick via `rdfs:seeAlso`
  where those model the concept structurally; the spine (`rec:Building`,
  `rec:ownedBy`, `rec:operatedBy`, geo, vCard, schema.org, FOAF, PROV) is
  reused directly.
- `CONSUMPTION_NS` — `https://solid.ti.rw.fau.de/gra/consumption.ttl#` →
  `vocab/consumption.ttl`. A SOSA profile: the energy-dataset model
  (`EnergyDataset` ⊑ `sosa:ObservationCollection`, granularity, scenario,
  observable properties, `EnergyConsumptionReading` ⊑ `sosa:Observation`) and
  the derived layer (aggregated-view definitions/snapshots, benchmark results).
- `GRAN_NS` — `https://solid.ti.rw.fau.de/gra/vocab.ttl#` → `vocab/vocab.ttl`.
  App/interop plumbing only: the sharing-log `kind` routing hint, the data-room
  membership roles, preferences, bookmarks.

The base is public (`gra/`, not the earlier `private/granergize/`), so the term
IRIs dereference for any cross-Pod consumer. The cutover from the old
stakeholder-partitioned namespaces was clean — no aliases, no tombstones; Pod
data written under the old IRIs is invisible to the app and gets re-created.

## Keeping in sync with the code

`src/services/rdf/vocab.test.ts` parses these files and asserts that every term
the app references (the building field-schema predicates + their
object-property ranges, the controlled-vocabulary instances, and the
energy/view/benchmark terms) is defined here. Add a term to the code and the
test fails until it's defined in the matching file — so the repo vocab can't
silently drift from what the app writes.

## Publishing to the Pod

A `PUT` replaces the whole resource, so publish the entire file (these are the
master copy — no manual merge needed):

```sh
# Authenticate to the Pod as your setup requires.
curl -X PUT -H "Content-Type: text/turtle" \
  --data-binary @vocab/building.ttl \
  https://solid.ti.rw.fau.de/gra/building.ttl
```

(repeat per file). The retired documents under `private/granergize/` should be
deleted. These documents are deliberately **not** copied into the app's `dist/`
build: they're served from the FAU Pod at their canonical IRIs, a different
origin than the app's deploy host.

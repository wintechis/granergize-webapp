# MaStR ↔ our model — shared patterns and the term mismatch

`linked-mastr` (the Ontologycentral wrapper that publishes the German
Marktstammdatenregister as Linked Data, `~/projects/linked-mastr`) is an external
RDF source the app integrates — directly, in the Logistikimmobilien import, and as
a reference for how a sibling energy dataset is modelled. Both it and our
buildings/aggregations model are LDP follow-your-nose RDF over the same W3C
vocabularies (SOSA/PROV/geo/vCard/SKOS/FOAF), so several modelling decisions
recur. This note records the parallels worth keeping aligned, and the one place
the entity vocabularies genuinely differ.

## Entity correspondence (and where it breaks)

MaStR decomposes an energy plant into three things; only one has an analogue here.

- **Einheit** (unit, `SEE`) — the *technical generating/consuming unit* (one PV
  array, turbine, battery, CHP engine). Carries the coordinates, address,
  per-unit capacity (`Bruttoleistung`/`Nettonennleistung`), `Energieträger`, its
  operator and its Lokation. ≈ our **technical-system sub-nodes** `<#pv>` /
  `<#battery>` on a building (the equipment, with its own operator and metric).
- **Anlage** (installation: `EegAnlage` / `AnlageStromSpeicher` /
  `AnlageKwk`) — a *regulatory plant grouping* a unit links up to
  (`EegMaStRNummer` / `SpeMastrNummer` / `KwkMaStRNummer`), carrying the
  headline/plant-level figures and registration data that aren't per-unit: the
  storage Anlage's usable kWh, the KWK Anlage's thermal + electrical output, the
  EEG-Anlage's subsidy registration + refurbishment history. **This is not a
  building.** It is an energy-plant registration, orthogonal to real estate. We
  have **no separate Anlage node**: the app folds that headline figure onto the
  system node itself (`<#pv>` carries kWp; `<#battery>` its capacity).
- **Lokation** (`SEL`) — the *technical site* grouping units that share one
  grid-connection setup (a Liegenschaft, grid-topology-defined). The nearest
  thing MaStR has to a place; it is **not** real estate either.

So **MaStR has no building/real-estate concept** at all. Our `rec:Building`
(`building.ttl`) is a real-estate entity that *hosts* units; in MaStR terms a
building would gather Einheiten across one-or-more Lokationen, and the units it
hosts may belong to different Anlagen. The join the import actually has is by
coordinates / AGS (and a shared Lokation), never a shared building IRI.

## Patterns we share

- **Subordinate resource = hash-fragment node in the parent document.** MaStR
  `<abr/…#role-UN>`, `<eeg/…#refurb-42>`; ours `<…#pv>` / `<…#battery>` and the
  `prov:qualifiedAttribution` node inside the building file — a subordinate
  resource is a hash-fragment (or blank) node in its parent's document, never a
  document of its own.
- **Thing vs describing document** (`#it` + `foaf:primaryTopic`; httpRange-14) —
  the same resource/document split our Pod URIs use.
- **Materialised projection only where the consumer can't fold.** MaStR
  materialises the operator→unit/site inverse because a follow-your-nose client
  can't walk a foreign key backwards; we materialise the WAC `.acl` from the
  `shared-out` log (the server's WAC engine can't fold the log) and the
  aggregation **snapshot** from the rollup (a recipient can't recompute it) for
  the same reason. Same discipline every time: the source/event is ground truth,
  a derived projection is persisted only for a consumer that cannot compute it,
  and stays rebuildable from the source.
- **Place modelled twice: owned point + borrowed SKOS region.** MaStR `geo:Point`
  on the unit plus `dcterms:spatial` to an `ags` `skos:Concept`; ours the
  building `geo:Point` plus a borrowed NUTS/LAU `skos:Concept`, the same shape as
  an aggregation's `cons:spatialExtent` (`consumption.ttl`). Controlled
  vocabularies are referenced external concepts, not minted.
- **PROV derivation + licence travel with derived data.** MaStR
  `prov:wasDerivedFrom` / `dcterms:source` / dl-de/by per record; imported
  buildings carry `prov:wasDerivedFrom` to the very MaStR record IRIs plus a
  `dcterms:source` match-rule note — the two chains join.
- **Grouping container with a navigable "has-members" edge** — MaStR Lokation
  `vocab:hasUnit`; our aggregation `includesBuilding`, building → its system
  nodes. One deliberate inversion: our shareable snapshot **drops** its members
  for k-anonymity, where MaStR keeps the list.

## Where we deliberately diverge — role vs identity

MaStR **fuses organisation and role**: the operator resource is one
*registration*, with the role baked into the MaStR-Nr prefix, so one company in
several roles becomes several unconnected IRIs (no `owl:sameAs`). Our model went
the other way on purpose: identity is a stable WebID/agent, role survives **only**
as data-room membership (`vocab.ttl` `UserRole`), and sharing is user→user, never
org→role. MaStR is the cautionary counter-example to that choice.

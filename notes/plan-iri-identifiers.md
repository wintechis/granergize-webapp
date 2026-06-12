# Building identity: IRIs as identifiers

A building's identity is its subject IRI. Nothing in the app rests on UUID
uniqueness, fragment conventions of foreign Pods, or any other probabilistic
or pattern-matched notion of identity — the one guarantee the web actually
gives, that an absolute IRI names one thing, is the only one used.

## The model

Own buildings are minted `<storageRoot>granergize/buildings/<uuid>.ttl#it`.
The uuid is a collision-free *local file name* and nothing more; the constant
`#it` fragment separates the building (the thing) from its document (the
information resource), so neither IRI does double duty.

The app-level id (`BuildingType.id`) is the subject IRI itself, in the
shortest honest form: the reference *relative to the user's own storage root*
(`granergize/buildings/<uuid>.ttl#it`) when the building lives on their Pod,
the full absolute IRI for buildings shared from elsewhere. The two shapes are
syntactically disjoint — a relative reference cannot carry an IRI scheme
(RFC 3986) — so no marker or lookup distinguishes them; `isAbsoluteIri` does.
The relative form survives a Pod migration, which the absolute form by
definition cannot. Foreign ids keep their fragment: one foreign document may
hold several buildings (`<#building-1>`, `<#building-2>`), and only the full
IRI keeps them distinct.

`buildingId.ts` (in `src/services/rdf/building/`) is the single chokepoint:
minting (`mintBuildingSubject`), id derivation (`buildingIdFor`), resolution
back to the absolute subject (`buildingSubjectFor`), document-URL extraction
(`buildingFileUrl`), and the display-only short form (`buildingIdStem`, used
in `Building <stem>` label fallbacks — never an identifier). No other code
splits fragments off building IRIs or concatenates subjects.

## Detection

A named-node subject is a building iff it is typed `rec:Building` — the
assertion every producer writes. The previous strict IRI-pattern matcher
(canonical `/buildings/<id>`, investor `building-<id>`, fragment heuristics
with a document-hash suffix for colliding generic fragments) existed to keep
arbitrary nodes from being mistaken for buildings; the explicit type does that
job directly, and the collision hash is obsolete because full IRIs cannot
collide. Legacy IRI shapes that carried no type are no longer recognised
(old Pod data is abandoned, not migrated — the standing rule).

## What stays absolute on disk

Documents are written with absolute IRIs throughout: the building file's
energy-dataset links, the datasets' back-references, prefs
(`gran:hiddenBuilding`), view definitions (`cons:includesBuilding`), and the
sharing log (`interop:forResource` — necessarily, since cross-agent references
cannot be relative). Document-relative writing was considered and rejected:
the archive restore already rewrites absolute IRIs term-precisely
(`rebaseTurtle` in `podArchive.ts`), so relative documents would buy
portability the rebase already provides, at the cost of touching every
consumer of every written document.

## Routes and encoding

Ids contain `/` and `#`. Inside the HashRouter a raw `#` truncates the route,
so every manually built link or test navigation URL-encodes the id
(`encodeURIComponent`); `useParams` decodes. The `?b=` URI state needs no
hand-encoding — `URLSearchParams` encodes and decodes on its own, and adding
encoding there would double-encode. The Manage rows' `data-building-id`
attribute carries the raw id; the e2e helpers `buildingRoute`/`exploreRoute`
(in `test/e2e/helpers/manage.ts`) own the encoding for spec navigations and
reject a null id loudly.

The energy detail page stays bookmarkable; the handbuch now describes the
Gebäude-Referenz as a URL-encoded reference best copied from the address bar
rather than constructed by hand.

## Knock-on simplifications

The view computer carries the subject IRI recorded in the view definition
verbatim instead of reconstructing an id from the file name and re-attaching
it as a fragment. The series-render benchmark deep-links the seeded series
building by the subject IRI the seeding endpoint returns, instead of
replicating the parser's old string-hash fold. The seeded-building helper
exposes `fileStem` as an explicitly local naming convenience, distinct from
identity.

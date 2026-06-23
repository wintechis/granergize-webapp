# Building detail — what hangs off a building URI

Two layers: §1 the RDF graph dangling off the building IRI on the Pod; §2 the
typed projection the detail renders (a whitelist, not a triple browser). §3 maps each
row/action back to its Pod file, keyed against
[`storage-layout.md`](./storage-layout.md). Source: `buildingParser.ts`,
`config/buildingConfig.ts`. The same projection backs the standalone `/building`
detail page (`Building.tsx`); the map and List are pure finders that navigate here —
there is no embedded detail pane.

## Subordinate resources (no detail page of their own)

Not every resource that hangs off a building is **first-class** in the UI. A
first-class resource has its own route/detail page — the building (`/building`),
an agent (`/contact`), an aggregation (`/aggregation`), a data room (`/room`), each
carrying its resource id as a `?ref=`/`?uri=` query param. A **subordinate
resource** has none: it is always rendered
*attached to its parent* (here, inside the building detail), never navigated to on
its own.

This is a **presentation-profile** distinction (whether the app gives a thing a
page), and it shadows the **resource-profile** partitioning shape
([`storage-layout.md`](./storage-layout.md)): how a thing is partitioned into Pod
resources is the storage-side of the same decision. An in-document subordinate
component is either a **hash (fragment) URI** (`<…/buildings/{id}.ttl#pv>`) or a
**blank node** — both live *inside the parent document*, fetched and PUT with it,
never resolved on their own. Use a fragment URI when the node needs a stable,
addressable identity (to be `owl:sameAs`'d or referenced from elsewhere — e.g. the
PV-system node, equated with its MaStR Einheit); a blank node suffices for a purely
internal component. A *contained child* (a separate slash-URI resource in the
parent's subtree) is the other subordinate form; a thing *linked* as a standalone document
the user navigates to and acts on is first-class. The two axes are coupled but not
identical — a resource can have its own URI/document and still be subordinate (the
energy observation collections, contained children), and a subordinate fragment can
be `owl:sameAs` a first-class resource elsewhere (the PV-system node
`<…#pv>` ≡ its MaStR Einheit). What ultimately makes it subordinate is that the app
gives it no page.

Subordinate to the building:

- **Technical systems** — the PV plant, heating/cooling, etc. A fragment node
  (`<…#pv>`) in the building document; a real entity with its own MaStR identity
  and even its own operator (distinct from the building's), yet it gets no page —
  it shows in the building detail's systems section. (See the building vocab's
  system component.)
- **Operating-cost** and **certification** blocks — in-document component nodes
  (blank nodes, or fragment URIs `<…#oc>`/`<…#cert1>` if an addressable identity is
  wanted).
- **Energy observation collections** — first-class resources at top-level
  `observations/{year}/…` (their own URIs), rendered only on the building's
  observation/energy page (`/observation`); an individual observation collection
  has no page of its own.

Rule of thumb: if it describes *part of* a building rather than a standalone thing a
user would navigate to and act on, model it as a component/attachment and render it
in the building detail — don't give it a route.

Two of the building entity's facets meet here: §1 is its **schema** in instance
form (what it *is*); §2–§3 are its **presentation profile** (how it renders) and
**resource profile** (where each row's data lives — its storage layout). The
schema and the profiles that dance around it are framed in
[`storage-layout.md`](./storage-layout.md).

"View" / "projection" here is the **UI** sense — a live, render-time projection
recomputed from the in-memory parsed triples on every render, persisted nowhere. It is
**not** a materialised view. The app's materialised projections — persisted,
point-in-time computed snapshots that are recomputed explicitly — are the unrelated
**aggregations** feature in [`aggregations.md`](./aggregations.md).

## 0. The root

`building.uri` = the marker's RDF subject (`buildingParser.ts` Pass 1,
`quad.subject.value`). `building.sourceUri` = the source file URI
(`quad.graph.value`). `building.id` is derived from the IRI tail (not a triple).
`building.attributedTo` (from the file's PROV qualified attribution, read in
`buildingParser.ts`) and `building.isShared` (set in `TurtleParsingService.ts` — own
buildings live under the storage root, shared ones don't) are derived during parsing,
not surfaced as graph rows. The backing-document URI shows atop the page as a dev-only
source link (`RdfSourceLink`, self-hiding outside Developer mode); everything below is
processed.

## 1. RDF graph off the building URI

```
<building URI>
├── direct datatype properties (predicateMap)
│     schema:customer → customer (agent IRI); geo:lat/long → lat/long;
│     vcard:locality/postal-code/region/street-address; rdfs:label;
│     bldg:hasBuildingArea/hasLandArea/officeArea (m²); bldg:hasPVSystem (bool);
│     bldg:investor → investor (agent IRI); bldg:usedAs; bldg:yearOfConstruction;
│     bldg:hasEnergyCertificate (PDF URI); rec:nace-code; rec:ownedBy/operatedBy
│     (agent IRIs)
├── building-vocab datatypes (predicateMap, BUILDING_NS)
│     buildingCode, hallArea, officeSocialArea, buildingHeight, numberOfLoadingDocks,
│     yearOfRenovation, leaseType, tenantIndustry, logisticsFunction,
│     climateControlType, greenLeaseShare, pvInstallationYear, pvCapacityKW,
│     companyName; hasOil/Gas/Electric/HeatPump/DistrictHeating (bool)
├── building-vocab IRI-valued (objectPropertyMap → relabelled local name)
│     shiftRegime, tenancyType, indoorTemperatureClass  (e.g. #OneShift→"1-Shift")
├── cons:hasEnergyDataset → <../observations/<year>/<id>.ttl#ds>  (repeatable)
│     One `cons:EnergyDataset` per (building, year, granularity, scenario), each its
│     own first-class resource under observations/; the link IRI is opaque, so the
│     building file **re-states** {year, granularity, scenario} about each dataset node
│     and `parseEnergyDatasetRefs` reads them WITHOUT fetching the dataset (model: see
│     `energy-model.md`). ⇒ building.energyDatasets[] (EnergyDatasetRef[]); phase 1
│     reads only the links, bodies fetched in phase 2 (annual) / lazily on click (series).
├── bldg:hasOperatingCosts → _:oc  ⇒ building.operatingCosts
│     wasteDisposal, insurance, routineCleaning{Office,Warehouse}, glassCleaning,
│     exteriorMaintenance, security, propertyManagement, caretaker,
│     repairAndMaintenance, operationInspectionAndMaintenance (bool)
├── bldg:hasBuildingCertification → _:cert (repeatable)
│     ⇒ building.certifications[]: { type (rdf:type *Certification), level, scope }
└── prov:qualifiedAttribution → _:attr  (provenance, never drives behaviour)
      prov:agent → attributedTo (WebID)   (no prov:hadRole — buildings carry no role)
```

For the render/dispatch story the dataset declares its `cons:granularity`
(`P1Y`|`PT15M`) and `cons:scenario` (`cons:Actual`|`cons:Planned`): annual (P1Y) carries
inline `sosa:ObservationCollection` observations, a series (PT15M) points at daily reading
files. Full dataset body model in `energy-model.md`.

Any predicate not in `predicateMap`/`objectPropertyMap` (or any unhandled
blank-node shape) is parsed by n3 but never attached — it never reaches the page.

## 1b. The building page (`Building.tsx`)

Reached at `/building?ref=…` (own) / `?uri=…` (shared) — the map and List finders
navigate here on a marker/row click. The page is a single scrolling column of
sections (`Stack` with dividers), each a sub-widget for one aspect of the building:

```
└── Building.tsx
      BuildingHeader            breadcrumb back to the list, name + address, the
                                producing-org attribution (`attributedTo`), an
                                owned/shared badge, a locator thumbnail, and the
                                backing-document URI as a dev-only source link
      MasterDataSection         §2 — read-first master data + inline Edit
      EnergySystemsSection      PV / battery / CHP technical systems
      EnergySummarySection      compact energy summary + sparkline → the full
                                energy page (`/observation`)
      BuildingFilesSection      files: inline upload / download / mark-as-certificate
      SharingSection            who it's shared with + revoke + a Share dialog
      StandortEnergieprofil ·   nearby MaStR generation + regional context, the roof
        RoofPlan ·              plan and neighbourhood/regional open-data context
        NeighbourhoodEnergyMap ·   (read-only, no Pod action)
        RegionalStatistics
```

Every action is **inline on the page**; modals survive only for Share and for
destructive confirmations (revoke / file delete). Energy and weather are **not** tabs
here — they live on the building's observation page (`/observation`, the `Energy` /
`AnnualEnergy` + `WeatherData` surfaces), which `EnergySummarySection` links to. A
palette-routed `?action=edit|share` opens the matching section's editor/dialog on
mount.

## 2. Master-data card (BuildingType → `MasterDataSection`)

`MasterDataSection`, using `detail/DetailView.tsx` primitives. Order:

```
(the identity header — icon, name, address, URI — is BuildingHeader's, §1b)
Source: <sourceUri>   (backing-document link; when present)
Customer / Operated By / Investor   (agent RefLink → `/contact?uri=<webid>`)
Type (UriLink); Coordinates (→ OpenStreetMap); Building/Land/Office Area (m²);
Has PV System (✓/✗); Year of Construction; NACE Code (→ nacecode.de);
Energy Certificate (→ "pdf")
if investor/benchmark predicates present (hasInvestorDetails, not role):
  §Building, §Heat Generation (✓/✗), §Certifications, §Operating Costs
```

Rows are conditional (`hasValue` / `!= null`) — absent fields don't render.
`energyDatasets`/`annualData` drive the energy summary + the `/observation` page, not
this card. The card has an **inline Edit** (`useUpdateBuilding`, no modal); the other
owner actions (files, share, hide) live in the sibling sections of the same page —
there is no separate Manage tab.

## 3. Row ↔ file ↔ action

Almost everything in the card is one file: every core/investor/benchmark property
is a triple on `<…/buildings/<id>.ttl#<id>>` (surfaced as the "Source:" row). The
exceptions are the energy datasets (separate per-(year,granularity,scenario) files,
linked by `cons:hasEnergyDataset`) and attached files including the certificate PDF
(bytes in the per-building `files/` container, linked by
`bldg:hasAttachment`/`bldg:hasEnergyCertificate`; only the link is in the building
file — see [`attachments.md`](./attachments.md)). Per-row file map below.

### 3a. Where each row lives

```
<building URI>, Source            granergize/buildings/<id>.ttl  (subject / graph IRI)
Customer/Operated By/Investor      agent IRI (no separate agents source any more)
core datatypes, investor/benchmark blocks   same building file
Energy Certificate / Files         link in building file; bytes in <dir>/files/ container
§Certifications / §Operating Costs blank nodes in the building file
energy charts (energyDatasets)     one cons:EnergyDataset file per (building, year,
                                   granularity, scenario), time-first under
                                   observations/<year>/<id>.ttl (model: energy-model.md)
```

Agent rows show the resolved agent name (the IRI fragment as fallback) + a `RefLink`
to `/contact`; the agent is resolved **lazily** from its own profile by the agent
resolver (name + logo, `resolveAgent`/`resolveAgentOrg`), not from any building-local
triple — there is no separate agents source on the Pod (the legacy `dataSources.ttl`
was removed).

### 3b. Actions (all fetch-fresh → patch n3 Store → PUT whole file; owner-only)

- **Edit** (inline in `MasterDataSection` → `useUpdateBuilding` → `updateBuilding`):
  PUTs the building file, patching scalar fields via inverse
  `predicateMap`/`objectPropertyMap`; blank-node structures preserved. Scope:
  address, lat/long (+ Nominatim geocode), areas, year, `operatedBy` (raw WebID),
  `hasPVSystem`, and the investor/benchmark block by its provenance category.
  `SKIP_FIELDS` (shown but
  not editable): `customer`, `investor`, `type`, `naceCode`, `energyCertificate`,
  and the array/object fields.
- **Files / energy certificate** (inline in `BuildingFilesSection` →
  `uploadAttachment` / `setEnergyCertificate`, `attachmentManager.ts`): PUTs each file
  to the per-building `files/` container, then PUTs the building file with the refreshed
  `bldg:hasAttachment` / `bldg:hasEnergyCertificate` link (see `attachments.md`). The
  per-year **Add / edit energy year** action (`EnergyYearDialog`, the `SaveObservation`
  intent) is likewise inline on the page via `EnergySummarySection` — there is no
  separate Manage tab.
- **Share** (`ShareBuildingDialog`): doesn't change building data — grants ACL read
  (`.acl`) and writes append-only `shared-out/`/`shared-in/` event logs
  (`interop/sharingLog.ts`). Event-log model (fold, revocation): see `sharing.md`.
- **Hide**: the persistent list is `gran:hiddenBuilding` in `prefs.ttl`
  (`prefs.ts`, `toggleHiddenBuilding`), folded into `readPrefs().hiddenBuildings`.

After Edit / certificate upload / energy-year edit the mutation invalidates the
building data, re-running the load flow (`storage-layout.md`).

### 3c. Gaps

- **Read ⊋ write**: agent links, `type`, `naceCode`, certifications, operating costs
  render on the page but aren't editable here (only authored via XLSX import,
  `AddBuildingDialog`). The energy certificate and per-year energy *are* writable
  inline on the page.

## Sub-widgets as affordance surfaces (intents)

`Building.tsx` composes one sub-widget per aspect of the building, and **each
sub-widget is an affordance surface for the intent catalog** (`src/intents/`): it
offers exactly the intents whose `entity` matches its aspect and whose
`applies(object, viewer)` guard passes (`intents/affordances.ts`). The widget is
*where* a verb is offered, not the verb's identity — the same intent also surfaces in
the `ObjectActions` menu and the ⌘K palette (the page registers its focused object via
`PaletteFocusContext`), so all three are **projections of one catalog**, not
independent action lists.

Each action-bearing sub-widget maps to its intents:

- `MasterDataSection` → `UpdateBuilding`, `DeleteBuilding`
- `EnergySummarySection` → `SaveObservation`, `DeleteObservation`
- `BuildingFilesSection` → `UploadAttachments`, `DeleteAttachment`, `SetEnergyCertificate`
- `SharingSection` → `ShareBuilding`, `RevokeBuildingAccess`
- header / focus handler → `ToggleVisibility`
- `StandortEnergieprofil` (nearby MaStR generation + regional context) → **read-only
  context, no intents** — it renders public-tier data as cards, with no Pod action.

So every sub-widget that *writes* has a catalog intent; the only intent-less section is
the read-only open-data context ([`open-data.md`](./open-data.md)). Adding a sub-widget that acts means adding its
entity + intent(s); the widget then surfaces them through the same `applies()` filter,
and the palette gets them for free.

## Relation to the role/shape model

The card and energy surfaces dispatch on the data, not a role (the model is owned by
[`data-schema.md`](./data-schema.md)): `MasterDataSection` renders whatever predicates
are present (`hasInvestorDetails`) — "the fields this building has," not a per-role
block — and the energy surfaces dispatch on the dataset's declared shape (`annualData`
/ `cons:granularity`), so one building can show both a PT15M time-series and a P1Y
annual chart. Provenance (`building.attributedTo`) is the producing agent only (no
role): it surfaces as the producer-org name + logo in the header and the map marker's
hover card (the "Data source" row), but it drives no role badge and the marker's
owned/shared distinction does not vary by it.

Still open:

- **REC-aligned labels.** Where master-data predicates map to REC
  (`data-schema.md` "Relation to REC"), the row labels/links could point at the REC
  term, making the page's external links (`UriLink`) resolve to a real ontology.
- **§3c gaps.** The certificate upload and per-year energy entry are now wired inline
  on the page. Still open: either make the read-only rows
  (`customer`/`investor`/`type`/`naceCode`) editable or mark them explicitly
  read-only rather than silently un-editable.

> Open: no faithful "raw RDF for this building" view exists — the page is the
> whitelisted projection above.

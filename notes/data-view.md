# Data view — the building pane (what hangs off a building URI)

Two layers: §1 the RDF graph dangling off the building IRI on the Pod; §2 the
typed projection the pane renders (a whitelist, not a triple browser). §3 maps each
pane row/action back to its Pod file, keyed against
[`data-layout.md`](./data-layout.md). Source: `buildingParser.ts`,
`config/buildingConfig.ts`.

## 0. The root

`building.uri` = the marker's RDF subject (`buildingParser.ts` Pass 1,
`quad.subject.value`). `building.sourceUri` = the source file URI
(`quad.graph.value`). `building.id` is derived from the IRI tail (not a triple).
`building.provenance` / `attributedTo` (from the file's PROV qualified attribution,
read in `buildingParser.ts`) and `building.isShared` (set in
`TurtleParsingService.ts` — own buildings live under the storage root, shared ones
don't) are derived during parsing, not surfaced as graph rows. The URI shows
verbatim atop the pane; everything below is processed.

## 1. RDF graph off the building URI

```
<building URI>
├── direct datatype properties (predicateMap)
│     schema:customer → customer (agent IRI); geo:lat/long → lat/long;
│     vcard:locality/postal-code/region/street-address; rdfs:label;
│     gran:hasBuildingArea/hasLandArea/officeArea (m²); gran:hasPVSystem (bool);
│     gran:investor → investor (agent IRI); gran:usedAs; gran:yearOfConstruction;
│     gran:hasEnergyCertificate (PDF URI); rec:nace-code; rec:operatedBy (agent IRI)
├── investor-vocab datatypes (predicateMap, INVESTOR_NS)
│     buildingCode, hallArea, officeSocialArea, buildingHeight, numberOfLoadingDocks,
│     yearOfRenovation, leaseType, tenantIndustry; hasOil/Gas/Electric/HeatPump/
│     DistrictHeating (bool)
├── investor-vocab IRI-valued (objectPropertyMap → relabelled local name)
│     shiftRegime, tenancyType, indoorTemperatureClass  (e.g. #OneShift→"1-Shift")
├── benchmark-vocab datatypes (predicateMap, BENCH_NS)
│     logisticsFunction, climateControlType, greenLeaseShare, indoorTemperature,
│     pvInstallationYear, pvCapacityKW, companyName
├── gran:hasEnergyDataset → <energy/<year>-<gran>[-planned].ttl#ds>  (repeatable)
│     One `gran:EnergyDataset` per (building, year, granularity, scenario), each its
│     own file; the slug is self-describing, so `parseDatasetSlug` derives
│     {year, granularity, scenario} from the URI WITHOUT fetching (model: see
│     `energy-model.md`). ⇒ building.energyDatasets[] (EnergyDatasetRef[]); phase 1
│     reads only the links, bodies fetched in phase 2 (annual) / lazily on click (series).
├── investor:hasOperatingCosts → _:oc  ⇒ building.operatingCosts
│     wasteDisposal, insurance, routineCleaning{Office,Warehouse}, glassCleaning,
│     exteriorMaintenance, security, propertyManagement, caretaker,
│     repairAndMaintenance, operationInspectionAndMaintenance (bool)
├── investor:hasBuildingCertification → _:cert (repeatable)
│     ⇒ building.certifications[]: { type (rdf:type *Certification), level, scope }
└── prov:qualifiedAttribution → _:attr  (provenance, never drives behaviour)
      prov:agent → attributedTo (WebID); prov:hadRole → provenance (category IRI)
```

For the render/dispatch story the dataset declares its `gran:granularity`
(`P1Y`|`PT15M`) and `gran:scenario` (`gran:Actual`|`gran:Planned`): annual (P1Y) carries
inline `sosa:ObservationCollection` observations, a series (PT15M) points at daily reading
files. Full dataset body model in `energy-model.md`.

Any predicate not in `predicateMap`/`objectPropertyMap` (or any unhandled
blank-node shape) is parsed by n3 but never attached — it never reaches the pane.

## 1b. Pane container (`ExplorePage.tsx` right grid)

Clicking a marker calls `focusBuilding(id)`, resetting a **focus trail** (nav
stack). The right grid renders the last entry:

```
└── currentBuilding →
      identity header (persistent across tabs): icon, "Building {id}",
        streetAddress / postalCode locality, region, <building URI> (UriLink),
        enlarge/shrink toggle
      Tabs: [Building data] [Energy data] [Weather data]
        tab 0 → <Building embedded hideHeader>  (§2)
        tab 1 → by data shape: annualData present → <BspEnergy> (company/logistics
                 fields) else <InvestorEnergy>; declared series / selected energy →
                 <Energy>; else "No energy data"
        tab 2 → <WeatherData>
```

An agent reference (`onNavigateAgent`) pushes an agent entry onto the trail;
selecting a new marker replaces it. `hideHeader` makes the card drop its own header
+ URI line (shown here instead); the card renders them only on the standalone
`/building/:id` route. Pane height is flex-driven (`IndexPage` 100vh column; tab
bar/footer `flexShrink:0`; content `flexGrow:1; minHeight:0`; right cell `height:
100%; overflow:auto`) — fills leftover height, scrolls internally.

## 2. View model (BuildingType) → card

`Building.tsx`, using `detail/DetailView.tsx` primitives. Order:

```
header (unless hideHeader): icon, "Building {id}", streetAddress / locality
<building URI>   (UriLink; only when !hideHeader)
Source: <sourceUri>   (UriLink; when present)
Customer / Operated By / Investor   (agent RefLink → /agent/<hash>)
Type (UriLink); Coordinates (→ OpenStreetMap); Building/Land/Office Area (m²);
Has PV System (✓/✗); Year of Construction; NACE Code (→ nacecode.de);
Energy Certificate (→ "pdf")
if investor/benchmark predicates present (hasInvestorDetails, not role):
  §Building, §Heat Generation (✓/✗), §Certifications, §Operating Costs
```

Rows are conditional (`hasValue` / `!= null`) — absent fields don't render.
`energyDatasets`/`annualData` drive the chart tabs, not this card. The card itself
is now **view-only** — it carries no Edit/Share/upload buttons; those owner-only
actions live on the **Manage** tab (`ManagePage.tsx`).

## 3. Row ↔ file ↔ action

Almost everything in the card is one file: every core/investor/benchmark property
is a triple on `<…/buildings/<id>.ttl#<id>>` (surfaced as the "Source:" row). The
exceptions are the energy datasets (separate per-(year,granularity,scenario) files,
linked by `gran:hasEnergyDataset`) and the certificate PDF (sibling `certificates/`
resource; only the link is in the building file). Per-row file map below.

### 3a. Where each row lives

```
<building URI>, Source            granergize/buildings/<id>.ttl  (subject / graph IRI)
Customer/Operated By/Investor      agent IRI (no separate agents source any more)
core datatypes, investor/benchmark blocks   same building file
Energy Certificate                 link in building file; PDF in <dir>/certificates/<id>_energy_certificate.pdf
§Certifications / §Operating Costs blank nodes in the building file
energy charts (energyDatasets)     one gran:EnergyDataset file per (building, year,
                                   granularity, scenario) under buildings/<id>/energy/
                                   (slug + bodies: see energy-model.md)
```

Agent rows render only the IRI fragment + a `RefLink`; the legacy agents data
source in `dataSources.ttl` was removed, so agent attributes (`schema:name`) no
longer load (the field is kept empty for the back-compat return shape).

### 3b. Actions (all fetch-fresh → patch n3 Store → PUT whole file; owner-only)

- **Edit** (`EditBuildingDialog` → `updateBuilding`, `buildingSerializer.ts:529`):
  PUTs the building file, patching scalar fields via inverse
  `predicateMap`/`objectPropertyMap`; blank-node structures preserved. Scope:
  address, lat/long (+ Nominatim geocode), areas, year, `operatedBy` (raw WebID),
  `hasPVSystem`, and the investor/benchmark block by its provenance category.
  `SKIP_FIELDS` (shown but
  not editable): `customer`, `investor`, `type`, `naceCode`, `energyCertificate`,
  and the array/object fields.
- **Energy certificate** (`EnergyCertificateDialog` → `uploadEnergyCertificate`,
  `certificateUploader.ts`): PUTs the PDF to `certificates/<id>_energy_certificate.pdf`,
  then PUTs the building file with a refreshed `gran:hasEnergyCertificate`. This and
  the per-year **Add / edit energy year** action (`EnergyYearDialog`) are per-building
  row actions on the **Manage** tab (`ManagePage.tsx`) — the map's detail pane is
  view-only.
- **Share** (`ShareBuildingDialog`): doesn't change building data — grants ACL read
  (`.acl`) and writes append-only `shared-out/`/`shared-in/` event logs
  (`interop/sharingLog.ts`). Event-log model (fold, revocation): see `sharing.md`.
- **Hide**: the persistent list is `gran:hiddenBuilding` in `prefs.ttl`
  (`prefs.ts`, `toggleHiddenBuilding`), folded into `readPrefs().hiddenBuildings`.

After Edit / certificate upload / energy-year edit the card invalidates the building
data, re-running the load flow (`data-layout.md`).

### 3c. Gaps

- **Read ⊋ write**: agent links, `type`, `naceCode`, certifications, operating costs
  render in the pane but aren't editable here (only authored via XLSX import,
  `AddBuildingDialog`). The energy certificate and per-year energy *are* writable,
  but via the **Manage** tab's row actions, not this pane.

## Relation to the role/shape model

How this pane relates to the data-driven model in
[`data-schema.md`](./data-schema.md). The card and energy tab dispatch on the data, not
a role:

- **Predicate-driven render.** There is no role gate — `Building.tsx` renders whatever
  predicates are present (REC/core + any `investor:*`/`bench:*` actually on the subject)
  via `hasInvestorDetails`. The card shows "the fields this building has," not "the block
  for its role."
- **Granularity-driven energy tab.** The energy tab dispatches by the dataset's declared
  shape (`annualData` presence / `gran:granularity`): a series (PT15M) renders the
  time-series chart, an aggregate (P1Y) the annual chart — and **one building can show
  both**, regardless of role.

Provenance (`building.provenance` / `attributedTo`; model in `data-schema.md`) is
deliberately **not** shown as a UI badge, and the map marker no longer varies by it —
it lives in the data, not the chrome.

Still open:

- **REC-aligned labels.** Where master-data predicates map to REC
  (`data-schema.md` "Relation to REC"), the row labels/links could point at the REC
  term, making the pane's external links (`UriLink`) resolve to a real ontology.
- **§3c gaps.** The certificate upload and per-year energy entry are now wired (on
  the Manage tab). Still open: either make the pane's read-only rows
  (`customer`/`investor`/`type`/`naceCode`) editable or mark them explicitly
  read-only rather than silently un-editable.

> Open: no faithful "raw RDF for this building" view exists — the pane is the
> whitelisted projection above.

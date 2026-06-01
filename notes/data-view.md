# Data view — the building pane (what hangs off a building URI)

Two layers: §1 the RDF graph dangling off the building IRI on the Pod; §2 the
typed projection the pane renders (a whitelist, not a triple browser). §3 maps each
pane row/action back to its Pod file, keyed against
[`data-layout.md`](./data-layout.md). Source: `buildingParser.ts`,
`config/buildingConfig.ts`.

## 0. The root

`building.uri` = the marker's RDF subject (`buildingParser.ts` Pass 1,
`quad.subject.value`). `building.sourceUri` = the source file URL
(`quad.graph.value`). `building.id` is derived from the IRI tail (not a triple).
`building.sourceRole` and `building.isShared` are computed in
`TurtleParsingService.ts`, not in the building's graph. The URI shows verbatim atop
the pane; everything below is processed.

## 1. RDF graph off the building URI

```
<building URI>
├── direct datatype properties (predicateMap)
│     schema:customer → customer (agent IRI); geo:lat/long → lat/long;
│     vcard:locality/postal-code/region/street-address; rdfs:label;
│     gran:hasBuildingArea/hasLandArea/officeArea (m²); gran:hasPVSystem (bool);
│     gran:investor → investor (agent IRI); gran:usedAs; gran:yearOfConstruction;
│     gran:hasEnergyCertificate (PDF URL); rec:nace-code; rec:operatedBy (agent IRI)
├── investor-vocab datatypes (predicateMap, INVESTOR_NS)
│     buildingCode, hallArea, officeSocialArea, buildingHeight, numberOfLoadingDocks,
│     yearOfRenovation, leaseType, tenantIndustry; hasOil/Gas/Electric/HeatPump/
│     DistrictHeating (bool)
├── investor-vocab IRI-valued (objectPropertyMap → relabelled local name)
│     shiftRegime, tenancyType, indoorTemperatureClass  (e.g. #OneShift→"1-Shift")
├── benchmark-vocab datatypes (predicateMap, BENCH_NS)
│     logisticsFunction, climateControlType, greenLeaseShare, indoorTemperature,
│     pvInstallationYear, pvCapacityKW, companyName
├── gran:hasEnergyMeasurementData / hasEnergyConsumptionDataset → _:ds  (dummy/bench)
│     _:ds → year (measurementYear|datasetDate), location (datasetLocation, resolved),
│            type  ⇒ building.energyData[] (only if all three present)
├── investor:hasOperatingCosts → _:oc  ⇒ building.operatingCosts
│     wasteDisposal, insurance, routineCleaning{Office,Warehouse}, glassCleaning,
│     exteriorMaintenance, security, propertyManagement, caretaker,
│     repairAndMaintenance, operationInspectionAndMaintenance (bool)
├── investor:hasBuildingCertification → _:cert (repeatable)
│     ⇒ building.certifications[]: { type (rdf:type *Certification), level, scope }
└── investor:hasInvestorAnnualData → _:dataset  (association only)
      annual figures come NOT from this node but from SOSA observations joined back
      via sosa:hasFeatureOfInterest:
      _:obs  hasFeatureOfInterest → <building URI>   (join key)
             observedProperty → Annual{Electricity,Heat,Water,Wastewater}Consumption
                              | RenewableSelfGeneratedShare
             hasResult → _:res (hasSimpleResult → value; ssn:hasUnit read, unused)
             phenomenonTime → _:time (time:hasBeginning → year)
      ⇒ grouped by (building, year) into building.annualData[], sorted by year
```

Any predicate not in `predicateMap`/`objectPropertyMap` (or any unhandled
blank-node shape) is parsed by n3 but never attached — it never reaches the pane.

## 1b. Pane container (`Map.tsx` right grid)

Clicking a marker calls `focusBuilding(id)`, resetting a **focus trail** (nav
stack). The right grid renders the last entry:

```
└── currentBuilding →
      identity header (persistent across tabs): icon, "Building {id}",
        streetAddress / postalCode locality, region, <building URI> (UriLink),
        enlarge/shrink toggle
      Tabs: [Building data] [Energy data] [Weather data]
        tab 0 → <Building embedded hideHeader>  (§2)
        tab 1 → by sourceRole: benchmark→<BspEnergy>, investor→<InvestorEnergy>,
                 user/has energyNeed→<Energy>, else "No energy data"
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
if sourceRole === "investor":
  §Building, §Heat Generation (✓/✗), §Certifications, §Operating Costs
```

Rows are conditional (`hasValue` / `!= null`) — absent fields don't render.
`energyData`/`annualData` drive the chart tabs, not this card. Owner-only controls
(`!building.isShared`): Edit + Share buttons and dialogs.

## 3. Row ↔ file ↔ action

Almost everything in the card is one file: every core/investor/benchmark property
is a triple on `<…/buildings/<id>.ttl#<id>>` (surfaced as the "Source:" row). The
exceptions are the energy charts (separate/inline energy) and the certificate PDF
(sibling `certificates/` resource; only the link is in the building file).

### 3a. Where each row lives

```
<building URI>, Source            granergize/buildings/<id>.ttl  (subject / graph IRI)
Customer/Operated By/Investor      agent IRI → agents source in dataSources.ttl
core datatypes, investor/benchmark blocks   same building file
Energy Certificate                 link in building file; PDF in <dir>/certificates/<id>_energy_certificate.pdf
§Certifications / §Operating Costs blank nodes in the building file
energyData / annualData (charts)   dummy/bench: separate energy file(s);
                                   user: …/<id>/energy/<date>.ttl; investor: inline SOSA
```

Agent rows render only the IRI fragment + a `RefLink`; agent attributes
(`schema:name`) come from the agents source, not the building file.

### 3b. Actions (all fetch-fresh → patch n3 Store → PUT whole file; owner-only)

- **Edit** (`EditBuildingDialog` → `updateBuilding`, `buildingSerializer.ts:529`):
  PUTs the building file, patching scalar fields via inverse
  `predicateMap`/`objectPropertyMap`; blank-node structures preserved. Scope:
  address, lat/long (+ Nominatim geocode), areas, year, `operatedBy` (raw WebID),
  `hasPVSystem`, and the investor/benchmark block by role. `SKIP_FIELDS` (shown but
  not editable): `customer`, `investor`, `type`, `naceCode`, `energyCertificate`,
  and the array/object fields.
- **Energy certificate** (`EnergyCertificateDialog` → `uploadEnergyCertificate`,
  `certificateUploader.ts`): PUTs the PDF to `certificates/<id>_energy_certificate.pdf`,
  then PUTs the building file with a refreshed `gran:hasEnergyCertificate`.
  **Currently unreachable** — the dialog is rendered but nothing sets
  `energyCertificateUploaderOpen`, so it has no trigger.
- **Share** (`ShareBuildingDialog` → `shareBuildingData`, `interop/share.ts`):
  doesn't change building data. Grants ACL read (PUT `.acl`), POSTs an access-grant
  to the recipient's `ldp:inbox`; producer's `sharingRegistry.ttl` records it,
  recipient's `inbox.ts` copies the source into their `dataSources.ttl`.
- **Hide**: `Map.tsx onHide` just clears the focus trail. The persistent list
  (`gran:hiddenBuilding` in `hiddenBuildings.ttl`) is managed elsewhere.

After Edit / certificate upload the card calls `reloadData`, re-running the load
flow (`data-layout.md`).

### 3c. Gaps

- **Read ⊋ write**: agent links, `type`, `naceCode`, certificate, certifications,
  operating costs render but aren't editable here (only authored via XLSX import,
  `AddBuildingDialog`).
- **Certificate upload is dead UI** (un-triggerable).
- One building file mixes core + investor + benchmark predicates; `sourceRole`
  (computed, not stored on the subject) selects which block shows.

## Implications of the schema redesign (design — not yet built)

How this pane changes if the role/schema rework in
[`data-schema.md`](./data-schema.md) lands. Today the card is **role-driven**: a
`sourceRole === "investor"` gate (`Building.tsx`) decides which block renders, and
the energy tab dispatches on `sourceRole`. The redesign makes both **data-driven**:

- **Predicate-driven render.** Drop the role gate; render whatever predicates are
  present (REC/core + any `investor:*`/`bench:*` actually on the subject). The card
  becomes "show the fields this building has," not "show the block for its role."
  Removes the §3c "one file mixes blocks, sourceRole selects" wart. `predicateMap`
  already supports this; only the §2 render conditional changes.
- **Granularity-driven energy tab.** The tab dispatch (`BspEnergy`/`InvestorEnergy`/
  `Energy` by `sourceRole`) becomes dispatch by the dataset's `gran:granularity`:
  a series (PT15M) renders the time-series chart, an aggregate (P1Y) the annual
  chart — and **one building can show both**, regardless of role. Folds the three
  energy components toward one that switches on declared period.
- **Role → provenance badge.** `sourceRole` stops gating rendering; it becomes a
  small attribution label ("shared by … as investor"), matching its new
  provenance-only meaning.
- **REC-aligned labels.** Where master-data predicates map to REC
  (`data-schema.md` "Relation to REC"), the row labels/links can point at the REC
  term, making the pane's external links (`UriLink`) resolve to a real ontology.

Close the existing §3c gaps along the way: wire the **dead certificate upload**
(add the trigger), and either make the read-only rows (`customer`/`investor`/
`type`/`naceCode`) editable or mark them explicitly read-only rather than
silently un-editable.

## Pointers

`buildingParser.ts` (extraction, blank-node reassembly);
`config/buildingConfig.ts` (whitelist, coercion, relabelling);
`TurtleParsingService.ts` (sourceRole, isShared, hidden filter, energy load);
`Map.tsx` (container, trail, tabs); `Building.tsx` + `detail/DetailView.tsx` (card);
`Energy.tsx`/`InvestorEnergy.tsx`/`BspEnergy.tsx`/`WeatherData.tsx` (tabs);
`types/types.ts` (`BuildingType`); `EditBuildingDialog.tsx`, `BuildingDialogs.tsx`,
`interop/share.ts`, `certificateUploader.ts` (actions);
[`data-layout.md`](./data-layout.md) (on-Pod files).

> Open: no faithful "raw RDF for this building" view exists — the pane is the
> whitelisted projection above.

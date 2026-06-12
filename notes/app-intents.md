# App intents: entities and actions

The Apple App Intents model describes an app as a catalog of **entities** (the
nouns a user works with, each with a stable identity) and **actions** (the
verbs, each a named, parameterized, independently invokable operation with
declared effects). This note maps the Granergize-App onto that frame: what the
entities and actions already are, where the app already matches the model, and
what an explicit intents surface would add. It anchors the discussion; it is
not yet a plan.

The app is closer to this model than most: every entity is an RDF resource
with an IRI (identity is solved by construction), and the data layer already
enforces "one hook per user intent" — every user-intent Pod write is a named
mutation hook carrying a human-readable action label (`meta.action`), a
declared invalidation set, and a feedback surface. The read side is the same
shape: entities are surfaced exclusively through named query hooks. What does
*not* exist is any reification of this catalog — the intents live only as
TypeScript functions, invokable only from the specific dialog built for
each (the navigation verbs, serialized in deep links, are the one
exception).

## Intents as user-callable functions

The essence of an Apple intent: a named function with typed parameters and
a `perform()` body, **whose caller is the user rather than other code** —
invoked through Siri, Shortcuts, widgets, Spotlight, without going through
the app's own screens. The framework's whole move is taking what was
reachable only via a specific control in a specific view and giving it a
public signature: the intent catalog is the app's callable API surface for
humans (and the assistant). That is the same decoupling of verb from
dialog named below (§ What the intents lens adds); the mutation hooks are
already the functions, lacking only callers other than their dialogs.

Apple's event concept follows from this: a **donation** records "this
intent was performed, with these parameters, now" — an invocation event.
The system uses the stream only for prediction and suggestion; it is
telemetry about call history, advisory and discardable, never consulted to
reconstruct state (state stays opaque inside `perform()`). The contact
point with this app's architecture: the event-sourced logs are invocation
events *promoted to ground truth* — a grant event in `shared-out/` records
exactly the parameters of a performed share intent, which is why the event
vocabulary and the parameter vocabulary coincide (§ A drafted registry
entry), and the fold is what turns call history into state. Conversely,
which intents leave events at all is here the event-sourced/in-place split
([`queries-mutations.md`](./queries-mutations.md)) — an in-place
PUT erases its invocation history — whereas in Apple's model any intent
can donate, because the event stream is fully decoupled from state.

## Where intents sit

Seen end to end, the app has two sides: an HTTP/Solid connector with a small
operation grammar (the query/mutation split, the two storage models and
their projection disciplines — [`queries-mutations.md`](./queries-mutations.md)), and
user events on the other. An **intent is the named mapping between them**: a
user event invokes one named verb, and the verb owns the combination of HTTP
requests it commits — which requests, in what order, through which mechanism,
and which cached reads it invalidates afterwards. The request combinations
are not scattered through the UI; they are already reified as these named
units, which is what makes a registry feasible at all. (This mapping covers
the read and write families; the navigation and session verbs — § Actions —
act on UI and session state and commit no Pod requests.)

The coupling is asymmetric, and only the write half is event-driven. Writes
are imperative: event → intent → requests. Reads are declarative: components
state data needs as queries, and the data layer decides when HTTP happens —
on mount, and when a write invalidates the keys it declared
([`architecture.md`](./architecture.md) §render cycle,
[`app-pod-state-sync.md`](./app-pod-state-sync.md)). So the read side hangs
off the intent catalog reactively: an intent's invalidation set is the
declared seam between its effect and every projection that must reflect it.
A registry entry, then, has a natural two-part shape: the event-side
signature (name, parameters) and the request-side effect (mechanism,
resources touched, invalidations).

## Entities

Each entity names its identity, its storage/ownership model
(event-sourced log, in-place resource, or derived projection — see
`notes/queries-mutations.md`), and its RDF class — the `rdf:type` the
resource carries on the Pod, the natural value of an Apple-style entity
type. Each CURIE links its full IRI.

- **Building** ([`rec:Building`](https://w3id.org/rec#Building)) — the
  central entity. An in-place Turtle resource under `buildings/`; identity
  is the resource IRI. Carries master data, a PROV attribution to the
  producing agent, attachments, and an optional energy certificate. Owned
  vs shared-with-me is a property of how the user reaches it (own container
  listing vs the shared-in fold), not of the entity.
- **Energy dataset**
  ([`cons:EnergyDataset`](https://solid.ti.rw.fau.de/gra/consumption.ttl#EnergyDataset),
  also a
  [`sosa:ObservationCollection`](http://www.w3.org/ns/sosa/ObservationCollection)) —
  per-building, per-shape: an annual aggregate or a sub-hourly series,
  distinguished by declared granularity. In-place resources; the year is
  the natural sub-identity users act on.
- **Attachment** ([`schema:MediaObject`](http://schema.org/MediaObject),
  linked via
  [`bldg:hasAttachment`](https://solid.ti.rw.fau.de/gra/building.ttl#hasAttachment)) —
  a file on a building (incl. the energy certificate role). In-place binary
  resource, identity by IRI, rendered from building data.
- **Aggregated view**
  ([`cons:AggregatedViewDefinition`](https://solid.ti.rw.fau.de/gra/consumption.ttl#AggregatedViewDefinition) +
  [`cons:AggregatedViewSnapshot`](https://solid.ti.rw.fau.de/gra/consumption.ttl#AggregatedViewSnapshot);
  [`cons:View`](https://solid.ti.rw.fau.de/gra/consumption.ttl#View) is the
  kind in sharing events) — a definition plus a computed snapshot, both
  in-place Turtle resources. The snapshot is derived but persisted
  (shareable as a thing in itself).
- **Benchmark**
  ([`cons:BenchmarkResult`](https://solid.ti.rw.fau.de/gra/consumption.ttl#BenchmarkResult) —
  a received `cons:AggregatedViewSnapshot`) — a received comparison
  artifact; read-only from this app's perspective (it arrives via sharing).
- **Grant / share**
  ([`interop:AccessGrant`](http://www.w3.org/ns/solid/interop#AccessGrant) /
  [`interop:AccessRevocation`](http://www.w3.org/ns/solid/interop#AccessRevocation)) —
  an event in the append-only `shared-out/` log (mirrored into the
  recipient's `shared-in/`). The log is ground truth; WAC ACLs are a
  rebuildable projection of it. Every share dimension (recipient, kind,
  per-year scope) lives in the event.
- **Inbox notification** (the same `interop:AccessGrant`/`AccessRevocation`
  shape — a delivered copy, not a class of its own) — an event in the
  app-scoped inbox container; consumed (drained) rather than edited.
- **Data room** (conceptually a
  [`sioc:Usergroup`](http://rdfs.org/sioc/ns#Usergroup); its events are
  [`as:Join`](https://www.w3.org/ns/activitystreams#Join) /
  [`as:Leave`](https://www.w3.org/ns/activitystreams#Leave) /
  [`as:Update`](https://www.w3.org/ns/activitystreams#Update) with
  [`sioc:has_function`](http://rdfs.org/sioc/ns#has_function) →
  [`gran:UserRole`](https://solid.ti.rw.fau.de/gra/vocab.ttl#UserRole)) — an
  event-sourced membership+role log per room. The only place a role exists
  in the system.
- **Contact**
  ([`vcard:Individual`](http://www.w3.org/2006/vcard/ns#Individual), member
  of a [`vcard:AddressBook`](http://www.w3.org/2006/vcard/ns#AddressBook)) —
  a remembered agent (WebID + cached label) in an in-place contacts
  resource.
- **Organisation**
  ([`org:Organization`](http://www.w3.org/ns/org#Organization) +
  [`foaf:Organization`](http://xmlns.com/foaf/0.1/Organization)) — the
  user's own org node on the WebID profile (in-place, but on the profile
  document, not under the app collection).
- **Preference**
  ([`gran:Preferences`](https://solid.ti.rw.fau.de/gra/vocab.ttl#Preferences)) —
  hidden-building flags and similar, in-place in `prefs.ttl`.
- **Bookmark**
  ([`gran:Bookmarks`](https://solid.ti.rw.fau.de/gra/vocab.ttl#Bookmarks)) —
  a remembered data-room reference, in-place.
- **Agent** ([`foaf:Agent`](http://xmlns.com/foaf/0.1/Agent)) — an external
  identity (WebID), resolved and cached but never owned or written (except
  one's own org node, above).

### Entity queries

Apple pairs every entity with a mandatory **EntityQuery** — an imperative,
by-identity resolver (identifier → instance, plus optional string-search /
enumerate / predicate variants) the system calls while binding an intent's
parameters. That is not what the app's query hooks are: a hook is a
*subscription on a state node* (collection-shaped, cached, invalidated by
writes), whereas an EntityQuery is a one-shot call made mid-edge, below any
view machinery. The app fills the resolver role only implicitly — a route's
`:id` is resolved by filtering the already-loaded collection folds in
memory; there is no named "resolve building by IRI" read. So the mapping is:
hooks ≈ subscription+cache machinery Apple doesn't have; EntityQuery ≈ a
per-entity resolution seam the app hasn't reified. An external intents
surface would need that seam as a second below-React artifact beside the
intent cores (§ Current state): parameter binding needs IRI → typed
instance without a component tree.

Find/list verbs follow from the same design. In the Apple model "list
buildings" is not an authored intent: the entity's query is declared once
(enumerate-all or find-by-predicate variants), and the system *derives* a
"Find X" action from it — filter and sort parameters included. The
underlying split is data-returning vs UI-showing: a find returns entities
to the *caller* (composable into the next intent's parameter slot), while
showing the list in the app is an authored navigation intent (the `Show…`
verbs below; Apple's `OpenIntent`). The catalog mirrors the exclusion —
subscription reads stay off the verb list — but Apple adds the
constructive half: were the registry to grow an external surface (palette,
LLM tools, Shortcuts-style composition), list/find verbs would be derived
from per-entity query declarations, not authored as catalog entries; only
the `Show…` half needs authoring.

## Actions

The user-intent catalog: a flat enumeration of named verbs, each as much an
identity as the entity classes above (the IRI is `int:` + the name, per
§ A drafted registry entry). The top-level discriminator is the intent's
**effect kind** — which of the app's state spaces the verb acts on — the
catalog-level face of the `effect` discriminator in the in-code table
(§ The declarative intents table, which sketches the read and write kinds).
Signatures are abbreviated: entity parameters by role name, payloads by a
collective name, `?` optional, `*` zero-or-more; exact ranges and
cardinalities belong to the shape declarations (§ A drafted registry
entry).

Each effect kind has its own result channel. A write's result is the Pod
effect plus the invalidations — callers get an outcome shape
(`binary`/`tally`), never a value. A read's result is the returned value,
so its result type is declared (`returns`, mandatory). A navigation's
result is the entered UI state itself, consumed by the user rather than
returned to a caller — and anything it could return would be redundant,
since the state identifier is the invocation's own parameter bindings (the
deep link); success is simply "you are now there" (Apple's pure
`OpenIntent` likewise performs to an empty result). Session is
navigate-shaped: `Login`'s result is the authenticated session state,
observable, not returnable.

### Session

No Pod write, no route — an IdP redirect dance — but the first named verb a
user invokes, and the precondition every other intent assumes.

- `Login(provider)`
- `Logout`

### Navigate

Enter an addressable UI state; the parameters are exactly that state's URI
bindings (route + `?tab=`/`?b=`/`?dt=`), so every deep link is already a
serialized invocation. One verb per addressable state. No mechanism, no
invalidation; the entered state's declared data needs do the reading
(§ The UI as a state machine).

- `ShowDashboard(tab)`
- `ShowExplore(building, detailTab)`
- `ShowBuilding(building)`
- `ShowEnergy(building)`
- `ShowView(view)`
- `ShowRoom(room)`

### Read

User-invoked one-shot reads with their own feedback surface. Each declares
its result type (`int:returns` / `ReadIntentDef.returns`): the returned
value is a read-intent's entire point, and an undeclared result is a dead
end in any composition — Apple makes the same move with `ReturnsValue<T>`,
the basis of Shortcuts pipelines. The embedded confirmation previews
(wipe, restore) stay entry-less (§ Open questions). No list/find verbs
appear here: those derive from per-entity query declarations, not authored
intents (§ Entity queries).

- `DownloadArchive` — returns the archive file; developer-exposed.
- `CheckSharingConsistency` — returns the dry-run log↔ACL drift report;
  developer-exposed.
- `ExportBuildingWorkbook(building, style)` — returns the workbook: a
  client-side derivation from already-loaded data, no fresh Pod read at
  all.

### Write

The mutation hooks; each name carries its storage-model / projection
metadata in the table.

- `AddBuilding(source)` — the source a spreadsheet file or manually entered
  fields; multi-building, abortable, tally outcome.
- `UpdateBuilding(building, fields)`, `DeleteBuilding(building)` — in-place
  building writes.
- `ToggleBuildingVisibility(building)` — a preference write, not a building
  write.
- `SaveEnergyYear(building, dataset)`,
  `DeleteEnergyYear(building, dataset)` — in-place dataset writes (the
  dataset names year, granularity and scenario; save carries the values).
- `UploadAttachment(building, files)`,
  `DeleteAttachment(building, attachment)`,
  `SetEnergyCertificate(building, attachment?)` — in-place; an absent
  certificate attachment clears the flag.
- `ShareBuilding(building, recipient, energyYear*)` (absent years mean
  all), `ShareView(view, recipient)` (the snapshot only),
  `RevokeBuildingAccess(building, recipient)`,
  `RevokeViewAccess(view, recipient)` — each an event-sourced append to
  `shared-out/` plus a materialized ACL projection and an inbox
  notification.
- `CreateView(definition)` (definition + initial snapshot, one intent in
  two steps), `RefreshView(view)`, `DeleteView(view)` — in-place; delete
  first revokes every recipient.
- `CreateRoom`, `EnterRoom(room)`, `LeaveRoom(room)`, `DeleteRoom(room)`,
  `SetMembershipRoles(room, roles)` — event-sourced appends to the room
  log. `EnterRoom` is not a pure join: there is one current room, so
  entering joins the room, implicitly leaves the previous one, and writes
  the current-room preference.
- `BookmarkRoom(room)`, `RemoveRoomBookmark(room)` — in-place.
- `SaveContact(agent)`, `RemoveContact(agent)` — in-place.
- `SaveOrganisation(fields, logo?)` — profile write + logo upload.
- `AddDemoBuildings`, `AddDemoContacts`, `AddDemoRooms` — bulk in-place
  seeding, tally outcome; developer-exposed (the empty-Pod offer banner is
  the ungated affordance).
- `UploadArchive(archive)` — restore: bulk in-place write embedding a
  reconciliation; developer-exposed.
- `RebuildSharingFromLog` — the user-facing face of the ACL-rebuild
  reconciliation; developer-exposed.
- `CheckForNewShares` — the user-facing face of the inbox drain (archive
  each message into `shared-in/`, then delete it); developer-exposed.
- `RemoveAllAppData` — terminal wipe: confirmation with computed preview,
  long-running and cancellable, whole-cache invalidation;
  developer-exposed.

The developer-exposed verbs are catalog entries like any other write:
developer mode is the `exposure` attribute, not a reason for exclusion.
Two of them forced new dimensions onto the intent shape (confirmation,
progress/abort, tally, whole-cache invalidation) — see § The boundary
cases.

One action class stays outside the catalog: **reconciliation actions** —
system-initiated repairs that make a projection match the log (inbox drain,
stale-grant prune, the ACL rebuild inside restore). Not user intents, so no
entry; where a reconciliation does get a user-facing button, that button is
its own intent (`RebuildSharingFromLog` and `CheckForNewShares` above)
wrapping the same repair.

## What the intents lens adds

The catalog above exists, but only implicitly. An explicit intents surface
would mean some subset of:

- **A registry.** The catalog as data rather than convention — each intent's
  name, label, parameter shape, target entity, and effect class in one
  declared place, so a command palette, deep links, or automation could
  enumerate it. Today the nearest thing is the union of the mutation hooks.
- **Invocability outside the owning dialog.** Entities are already
  deep-linkable (hash routes exist for building, energy, view), and so are
  the navigation intents — a deep link is a serialized Show invocation. The
  read and write verbs are not: each is reachable only through the one
  dialog built for it. An intent-with-parameters route (or palette) would
  decouple verb from dialog.
- **Parameter schemas.** Mutation variables define each intent's parameters,
  but only in TypeScript. Exposing intents to anything non-TS (URL, palette
  with prompts, an LLM tool surface) needs them declared.
- **Entity references in parameters.** Solved for free: every entity
  parameter is an IRI.
- **Donation/discoverability** (the Apple sense — surfacing likely next
  actions) — purely speculative here; noted for completeness.

## Schemas: shared intent shapes

Apple layers a third concept on top of intents: **assistant schemas** —
published, standardized shapes for the most common intents and entities,
grouped into domains (Photos, Mail, Browser, Spreadsheets, …). A schema fixes
an intent's name, parameter list, and entity property shape; an app *conforms*
to the schema rather than minting its own signature, and conformance is
checked at compile time. The payoff is generalization: the assistant's model
is trained on the fixed shapes, so it can invoke any conforming app's intent
without app-specific knowledge. Custom (non-schema) intents stay invokable,
but only via explicit phrases — they don't get the generalized understanding.

In RDF terms a schema is a shared vocabulary term with a fixed property
shape, where conformance plays the role of a shape constraint — versus plain
App Intents, where every app mints terms in a private namespace. Apple acts
as the central vocabulary authority, and training the model on the shapes is
their substitute for dereferenceable semantics.

The transferable insight: the valuable artifact is not a private catalog but
a **published shape that external agents are built against**. Whatever
invokes intents generically — a command palette, an LLM tool surface, another
Solid app — needs the shapes declared somewhere it can read, and shared
shapes beat bespoke ones wherever more than one app could conform. This
weighs on the registry question below in favor of RDF in `vocab/`: there the
intent catalog is itself dereferenceable data, in the same place and form as
the entity vocabulary it refers to.

## A drafted registry entry

A sketch of what one entry could look like as RDF, using share-building (the
richest intent: IRI-valued and literal parameters, an optional dimension, a
multi-mechanism effect, an inline feedback surface). The `int:` namespace is
hypothetical — a fourth vocabulary at the public `gra/` base, pending the
authority question below.

The central choice in the draft: **the intent declares its event-side
signature as a ShEx shape**, and an invocation is any node conforming to it.
That answers the conformance-mechanism question concretely (validation, not
a compiler), and it makes an invocation a plain RDF resource — exactly what
a deep link, a palette, or an LLM tool call would construct. ShEx suits the
signature role well: its default cardinality is exactly-one, so a shape
reads like a function signature, and the schema is its own compact-syntax
document beside the registry rather than triples interleaved with it.
Mechanisms and feedback surfaces are named individuals, mirroring the named
mechanism values. On-Pod resources are described by *role*, not IRI — actual
resource IRIs are per-Pod, so the registry can only name which part of the
app tree an intent touches.

The registry entry (`intent.ttl`):

    @prefix int:  <https://solid.ti.rw.fau.de/gra/intent.ttl#> .
    @prefix bldg: <https://solid.ti.rw.fau.de/gra/building.ttl#> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

    int:ShareBuilding a int:Intent ;
        rdfs:label "Share building"@en ;
        rdfs:comment """Grant a recipient read access to a building,
          optionally restricted to given energy years. Appends a grant
          event to the shared-out log (ground truth), projects it into
          the building's ACL, and delivers a copy of the event to the
          recipient's inbox."""@en ;
        int:actionLabel "share the building"@en ;
        int:targetEntity bldg:Building ;

        # event-side signature: the shape an invocation conforms to
        int:parameterShape int:ShareBuildingInvocation ;

        # request-side effect
        int:mechanism int:eventSourcedAppend , int:aclProjection ;
        int:appendsTo int:sharedOutLog ;
        int:projectsTo int:buildingAcl ;
        int:notifies int:recipientInbox ;
        int:invalidates int:sharedOutLogQuery ;
        int:feedbackSurface int:inlineAlert .

The companion schema (`intent.shex`) — unannotated properties are
exactly-one, ShEx's default:

    PREFIX int:  <https://solid.ti.rw.fau.de/gra/intent.ttl#>
    PREFIX bldg: <https://solid.ti.rw.fau.de/gra/building.ttl#>
    PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    PREFIX xsd:  <http://www.w3.org/2001/XMLSchema#>

    int:ShareBuildingInvocation {
      int:intent     [ int:ShareBuilding ] ;
      int:building   IRI ;          # a bldg:Building
      int:recipient  IRI ;          # a foaf:Agent (the WebID)
      int:energyYear xsd:gYear *    # zero or more; absent means all years
    }

An invocation is then just a conforming resource — constructable from a URL,
a palette form, or a tool call, and validatable before dispatch:

    [] int:intent int:ShareBuilding ;
        int:building <https://alice.pod.example/granergize/buildings/b42.ttl#b> ;
        int:recipient <https://bob.pod.example/profile/card#me> ;
        int:energyYear "2024"^^xsd:gYear .

What the sketch surfaces:

- The signature and the per-event share dimensions coincide: `int:energyYear`
  on the invocation is the same fact the grant event records
  (`interop:includesEnergyYear`). That is not accidental — the
  self-sufficient-log rule already forces every share dimension into the
  event, so the event vocabulary is close to being the parameter vocabulary.
- `int:invalidates` names a query, so the registry already needs read-side
  identifiers — the "do queries belong in the catalog" question answers
  itself at least to the level of *named keys*, if not full read-intents.
- The effect description (`appendsTo`/`projectsTo`/`notifies`) is
  documentation-grade, not executable: the hooks remain the implementation.
  That opens the drift question — see the next section.

## Registry drift

A registry that nothing checks is a second place for the truth to rot. The
app already has the answer in miniature: `vocab.test.ts`, the Tier-1 drift
guard that keeps the entity vocabularies in step with the code. Its shape:
parse the owned `vocab/*.ttl` files into a set of defined subject IRIs, then
walk the code's own declarative term tables (`buildingConfig`,
`vocabularies`, the role maps) and assert every owned term the code uses is
in that set. One direction only — code → vocab: a term added in code fails
until published; a published term the code ignores is fine. The guard works
because the code centralizes its term usage in walkable tables, and because
the test is hermetic (local file reads, no network).

The same pattern transfers to the intent registry, with two adaptations:

- **The walkable table doesn't exist yet.** The hooks declare some metadata
  (`meta.action`, and each hook's invalidation set in its `onSettled`) but
  not as one enumerable structure. The precondition for a drift guard is the
  same move `buildingConfig` made for building fields: a single declarative
  table of intents (name, action label, invalidation keys, mechanism) that
  both the hooks and the test read — the hooks *derive from* the table, the
  test checks the table *against* `intent.ttl`/`intent.shex`. Without that,
  a guard would have to parse hook source, which is not this codebase's way.
- **Two published artifacts, not one.** With ShEx the registry is a pair —
  `intent.ttl` (catalog + effects) and `intent.shex` (signatures) — so the
  defined-set step parses both, and the signature check is structural, not
  just presence: each table entry's parameters must match the shape's
  properties and cardinalities.

What such a guard can and cannot pin: presence (every intent in the table
has a registry entry and a shape, and — unlike the vocab guard — the reverse
too, since a registry entry without an implementation is a broken promise to
external callers), the action label, the invalidation keys, and the
parameter shape. The effect description (mechanism, resources touched,
notifications) stays assertable only if it, too, becomes declared metadata
in the table rather than prose; otherwise it remains documentation, checked
by review like the rest of `notes/`.

## The declarative intents table

A sketch of the table itself — the in-code half of the registry pair. It
lives in the data-access layer (it references query-key families), holds
pure data, and is the one structure the mutation hooks derive their
`meta`/invalidations from and the drift test walks. Shown with the same
share-building entry as the Turtle/ShEx draft, so the three artifacts can be
compared. Every entry shown is now backed by an implemented hook
(`useShareBuilding`, `useSeedDemoBuildings`, `useRemoveAppData`, and the
read-intents `useExportArchive`, `useAuditGrants` in `mutations.ts`) whose
declared facts the entries mirror one-to-one — the action phrase,
invalidation set, outcome shape, and abort-as-outcome execution are the
hooks' actual behaviour, not speculation. What remains unbuilt is the table
itself: today each hook hand-declares those facts, and the derive step
below is the missing move.

    // src/hooks/intentTable.ts
    export const INT_NS = "https://solid.ti.rw.fau.de/gra/intent.ttl#";

    /** The mutation mechanisms — storage model or projection write
        (queries-mutations.md). */
    export type Mechanism =
      | "event-sourced-append"
      | "in-place-write"
      | "acl-projection";

    export interface IntentParameter {
      /** Local name; the RDF property is `${INT_NS}${name}`. */
      name: string;
      nodeKind: "iri" | "literal";
      /** Class IRI for IRI-valued, XSD datatype IRI for literal-valued. */
      range: string;
      cardinality: "one" | "optional" | "zero-or-more";
      comment?: string;
    }

    /** Fields every intent carries, read or write. */
    export interface IntentBase {
      /** Local name; the intent IRI is `${INT_NS}${localName}`. */
      localName: string;
      label: string;
      /** The meta.action phrase ("Failed to {action}: …"). */
      action: string;
      /** Class IRI of the primary entity acted on; absent for
          collection-wide intents (remove-all acts on everything). */
      targetEntity?: string;
      parameters: IntentParameter[];
      /** Long-running intents own a progress surface; cancellable ones
          accept an abort signal. Cancelling a destructive intent leaves
          partial state — the outcome wording must admit that. */
      execution?: { longRunning: true; cancellable?: boolean };
      /** Laxest affordance visibility; "developer" means every affordance
          is dev-mode-gated. Default "standard". */
      exposure?: "standard" | "developer";
    }

    /** A write-intent — the command side of CQS (a mutation hook). */
    export interface WriteIntentDef extends IntentBase {
      effect: "write";
      mechanisms: Mechanism[];
      /** Pod-resource roles, mirroring int:appendsTo / projectsTo /
          notifies; writesTo / deletes are the in-place counterparts. */
      appendsTo?: string[];
      projectsTo?: string[];
      notifies?: string[];
      writesTo?: string[];
      deletes?: string[];
      /** Query-key families to invalidate, tied to queries.ts at compile
          time; "entire-cache" resets the world (queryClient.clear()) —
          expressible, but as a loud special value, not a fake enumeration. */
      invalidates: ReadonlyArray<keyof typeof queryKeys> | "entire-cache";
      /** Canonical feedback surface is inline (meta.silent — no toast). */
      silent?: boolean;
      /** Destructive intents confirm before dispatch; `preview` names the
          query whose result the confirmation embeds (what will be lost). */
      confirmation?: { preview?: string };
      /** "binary" (default): settled or failed. "tally": per-item
          best-effort with a {done, total} result ("Added N of M"). */
      outcome?: "binary" | "tally";
    }

    /** A read-intent — a user-invoked one-shot query (`@operation query`
        on the useMutation trigger primitive): no mechanism, nothing to
        invalidate, never cached — every invocation re-reads the Pod. */
    export interface ReadIntentDef extends IntentBase {
      effect: "read";
      /** Pod-resource roles read, mirroring int:readsFrom. */
      readsFrom?: string[];
      /** The declared result type (a class IRI or a result-shape name,
          mirroring int:returns). To an external caller the returned value
          is a read-intent's entire point — an undeclared result is a dead
          end in any composition (Apple: ReturnsValue<T>). */
      returns: string;
    }

    /** A catalog entry, discriminated on `effect` — the table-level
        mirror of the query/mutation split. */
    export type IntentDef = WriteIntentDef | ReadIntentDef;

    export const INTENTS = {
      // implemented: useShareBuilding
      shareBuilding: {
        localName: "ShareBuilding",
        label: "Share building",
        action: "share the building",
        effect: "write",
        targetEntity: `${BUILDING_NS}Building`,
        parameters: [
          { name: "building", nodeKind: "iri",
            range: `${BUILDING_NS}Building`, cardinality: "one" },
          { name: "recipient", nodeKind: "iri",
            range: "http://xmlns.com/foaf/0.1/Agent", cardinality: "one" },
          { name: "energyYear", nodeKind: "literal",
            range: XSD_GYEAR, cardinality: "zero-or-more",
            comment: "Absent means all years." },
        ],
        mechanisms: ["event-sourced-append", "acl-projection"],
        appendsTo: ["sharedOutLog"],
        projectsTo: ["buildingAcl"],
        notifies: ["recipientInbox"],
        invalidates: ["sharedOutLog"],
        silent: true,
      },
      // implemented: useSeedDemoBuildings
      addDemoBuildings: {
        localName: "AddDemoBuildings",
        label: "Add demo buildings",
        action: "add demo buildings",
        effect: "write",
        targetEntity: `${BUILDING_NS}Building`,
        parameters: [],
        mechanisms: ["in-place-write"],
        writesTo: ["buildingsContainer"],
        invalidates: ["buildings"],
        // Per-building best-effort: the result is {seeded, total}.
        outcome: "tally",
        // Affordances: the empty-Pod offer banner (ungated) and the account
        // menu (developer-gated) — "standard" because the laxest one is.
        exposure: "standard",
      },
      // implemented: useRemoveAppData (abort signal in variables; a cancel
      // resolves {aborted: true}; settle = queryClient.clear())
      removeAllAppData: {
        localName: "RemoveAllAppData",
        label: "Remove all app data",
        action: "remove app data",
        effect: "write",
        // No targetEntity: acts on the whole app collection.
        parameters: [],
        // The wipe is the degenerate in-place mutation — every resource
        // (event logs, in-place state, ACL projections) is uniformly state
        // to destroy; nothing is appended, folded, or projected.
        mechanisms: ["in-place-write"],
        deletes: ["appCollection"],
        invalidates: "entire-cache",
        // The preview names the implemented query the confirm embeds.
        confirmation: { preview: "listContainedResources" },
        execution: { longRunning: true, cancellable: true },
        exposure: "developer",
      },
      // implemented: useExportArchive — central busy/error handling on
      // the trigger primitive, zero Pod writes (test-pinned); the caller
      // saves the blob and toasts the count.
      downloadArchive: {
        localName: "DownloadArchive",
        label: "Download archive",
        action: "download the archive",
        effect: "read",
        parameters: [],
        readsFrom: ["appCollection"],
        returns: "http://schema.org/MediaObject", // the archive file
        exposure: "developer",
      },
      // implemented: useAuditGrants — the dry-run diffing twin of
      // rebuild-sharing; fresh per invocation (a cached audit would
      // report stale consistency), the verdict rendered by the caller.
      checkSharingConsistency: {
        localName: "CheckSharingConsistency",
        label: "Check sharing consistency",
        action: "check sharing consistency",
        effect: "read",
        parameters: [],
        readsFrom: ["sharedOutLog", "buildingAcl"],
        // A result shape minted in the intent vocabulary, not a reused class.
        returns: `${INT_NS}SharingAuditReport`,
        exposure: "developer",
      },
      // … one entry per user intent
    } as const satisfies Record<string, IntentDef>;

A hook then derives rather than declares:

    export function useShareBuilding() {
      const def = INTENTS.shareBuilding;
      // …
      return useMutation({
        mutationFn: /* unchanged service call */,
        meta: { action: def.action, silent: def.silent },
        onSettled: () => invalidateFamilies(def.invalidates),
      });
    }

Notes on the sketch:

- `as const satisfies Record<string, IntentDef>` means: check every entry
  against the `IntentDef` contract at compile time, but keep each entry's
  *exact* values as its type (not widened to generic strings) — so
  `INTENTS.shareBuilding.action` is known to the compiler as the literal
  phrase, and downstream code can be typed against specific entries.
- `invalidates: keyof typeof queryKeys` links the table to the query layer
  at compile time: renaming a query-key family in `queries.ts` breaks the
  build here, while the drift test covers the published-files half.
- The one seam TypeScript does not close in this sketch: nothing forces
  `parameters` to match the mutation's actual variables type. A mapped type
  over the variables could enforce it (every variable key must have a
  parameter entry); whether that rigor is worth the type-level machinery is
  an implementation-time call.
- Reconciliation actions stay out of the table. The two boundary-case
  account actions are *in* it — the entries above; the next section walks
  through which field answers which of their needs.
- Read-intents are entries of their own kind: `IntentDef` is a union
  discriminated on `effect`, the table-level mirror of CQS.
  `WriteIntentDef` carries mechanism / effect roles / invalidation /
  outcome; `ReadIntentDef` carries only what it reads (`readsFrom`);
  the shared signature (name, label, action, parameters, execution,
  exposure) lives in the base. The split is load-bearing, not cosmetic:
  a read entry *cannot* claim a mechanism or an invalidation — the
  compiler holds the query side pure, the same line the `@operation`
  tags draw at the service layer. `returns` is read-side only by the
  same logic: a write intent declares its outcome *shape*
  (`binary`/`tally`), never a result type — its real result is the Pod
  effect plus the invalidations, and no caller consumes a mutation's
  return value.
- `removeAllAppData`'s `confirmation.preview` names a query
  (`listContainedResources`) that has no entry of its own: it is invoked
  only from inside the confirmation flow, never as a standalone user
  verb — no affordance, no entry. Whether embedded previews should
  nevertheless be registered read-intents is in the open questions.

## The boundary cases: demo seeding and remove-all

The two account actions that long bypassed the mutation-hook layer — demo
seeding and remove-all-app-data — are the most instructive entries in the
table:
each forced a dimension onto `IntentDef` that the dialog-shaped intents
never needed. Both qualify as intents outright: nameable, user-decided,
parameter-free verbs an Apple-style registry would list without hesitation
(and whose quirks Apple's framework models first-class: destructive intents
declare a confirmation step, long-running intents report progress and
support cancellation). Field by field:

- **`confirmation` — consent with a computed preview.** Remove-all's
  confirm is not a static "are you sure?": it embeds the result of a *query*
  (the read-only recursive listing) enumerating the resources that will be
  destroyed. `preview` names that query — a destructive intent whose
  confirmation summary is produced by a query-shaped operation, which is
  the strongest internal pull yet toward read-intents being first-class
  (the same pull `int:invalidates` already exerts).
- **`execution` — long-running with progress and abort.** Remove-all
  threads an abort signal through the recursive delete and replaces the app
  shell with a progress surface while running. Cancelling a destructive
  intent inherently leaves partial state ("some data may already be
  deleted") — admitting that is part of the intent's outcome wording, not
  an error path. (The spreadsheet import's abortable upload is the same
  dimension, hidden inside an intent the table already covered; its entry
  would carry the same field.)
- **`outcome: "tally"` — partial success as a result, not an error.**
  Seeding is per-item best-effort and reports `{seeded, total}` ("Added N
  of M") — neither success nor the central `"Failed to {action}"` shape.
- **`invalidates: "entire-cache"`.** Seeding invalidates `buildings`;
  remove-all resets the world. A key-family list cannot say "everything",
  so the type admits it as a loud special value — better the schema
  surfaces an intent that resets the world than papers over it with a fake
  enumeration.
- **`exposure` — gated discoverability.** Remove-all is developer-gated
  throughout. Seeding shows the attribute really belongs to *affordances*,
  not the intent: its account-menu entry is gated, its empty-Pod offer
  banner is not — so the table records the laxest exposure and leaves
  per-affordance gating to the UI (resolved properly by the state-machine
  reading below: exposure is a guard on affordance edges).
- **`mechanisms` under deletion.** The wipe needs no third storage model:
  it is the degenerate in-place mutation, treating every resource — event
  logs, in-place state, ACL projections alike — uniformly as state to
  destroy; nothing is appended, folded, or projected. The effect is carried
  by `deletes` (a resource role, like `appendsTo`), keeping the
  storage-model taxonomy intact.

That these two were long the two hand-rolled handlers was not a
coincidence: they bypassed the hook layer because confirmation, progress,
and tally outcomes don't fit the hook shape. They are folded in now
(`useSeedDemoBuildings`, `useRemoveAppData` — the wipe on the established
abort-as-outcome pattern, its settle clearing the entire cache), and the
fold drew the line the fields above describe: the hook owns execution,
busy state, the central error toast, and the invalidation; the call site
keeps exactly the confirmation (with its computed preview) and the
progress surface. The remaining implementation question is whether the
entry's confirmation/execution metadata can *drive* those surfaces — a
generic confirm-with-preview and progress takeover rendered from the
table — instead of each call site hard-coding them.

## The UI as a state machine: affordances as edges

The intent catalog invites one more abstraction step: model the UI as a
state machine. Two formulations suggest themselves — "transitions are
intents" and "the possible intents of a state are its affordances" — and
the second is the accurate one.

"Transitions are intents" is only half-true. Most write intents barely
move the UI: firing share-building from its dialog lands back in
essentially the same state, and what changed is the *data* the state
renders, via the intent's invalidation set. In state-machine terms most
write intents are **self-loops** whose effect is on the Pod, with the
re-render falling out of the read side. The genuine UI transitions —
switching tabs, selecting a building — are the navigation intents
(§ Actions): verbs whose effect is on UI state rather than the Pod.
(Opening a dialog is neither: it is the parameter-collection half of a
write intent's affordance, below.) So the machine has two edge kinds:
navigation-intent edges (UI state changes, no Pod effect) and write-intent
edges (Pod effects, usually re-entering the same state). The exceptions
are telling: remove-all is one of the few write intents that *is* a real
transition (app shell → activity screen → map tab), which is part of why
it never fit the hook shape.

The strong form is the affordance reading: **an affordance is a
partially-applied intent offered by a state.** The state binds some
parameters from context, and the dialog collects the rest — the "Share
view" button on a view row is the affordance ⟨Manage state, ShareView,
view ≔ this row's entity⟩, and the dialog it opens is the
parameter-collection sub-machine for the unbound remainder. The dialogs
already behave as explicit machines: the share dialogs' confirm step is a
named state, and the shared close-guard semantics (backdrop never closes;
Escape confirms while dirty; closing suppressed while busy) are transition
guards in all but name.

This reading settles the exposure question from the boundary cases:
**exposure lives on edges, not on intents.** Developer mode is a guard
condition on a set of affordance edges; the seeding banner-vs-menu split
is two edges into the same intent with different guards (empty Pod and not
declined, versus developer mode). The table's `exposure` field is then the
summary of an intent's edges (the laxest guard), and a full affordance map
— which states offer which intents, with which bindings and guards — is a
third registry artifact alongside the catalog and the shapes.

What makes the framing more than decoration here:

- **States are already addressable.** The hash route plus the
  `?tab=`/`?b=`/`?dt=` parameters *is* a serialized state identifier —
  deep links are state names, and the URI-state spec pins exactly that.
  The missing half is the affordance map per state, not the state space.
- **It is HATEOAS for the UI.** "Each state carries the controls to its
  next states" is hypermedia as the engine of application state, and RDF
  already has a vocabulary for it: Hydra attaches operations to
  resources. An affordance map in the registry would be Hydra-shaped —
  the `int:` intents as operations, states as where they are offered —
  which strengthens the case for the registry living in `vocab/` as
  dereferenceable data.
- **The e2e specs are paths through this machine**, and their
  characteristic failure mode is state *misidentification* — a spec
  inferring "share dialog open" from an ambiguous predicate (a generic
  role=dialog locator) when the actual state was "create dialog closing"
  (`test/README.md` § Spec invariants). A reified state/affordance map
  gives tests authoritative state identity instead of locator heuristics.
- **Donation/discoverability presupposes it.** Surfacing an affordance
  outside its home state (a palette, Shortcuts-style suggestions) is by
  definition an operation on the affordance map: offering an intent edge
  from a state that doesn't normally carry it.

Two limits keep the model honest. The state space is not flat — it is
hierarchical and concurrent (tab × selection × open dialog × dialog step ×
busy), which is statechart territory (in the React ecosystem, XState is
the library for writing UIs as explicit hierarchical state machines —
using the *model* does not imply adopting the machinery). And reads do not
sit on edges at all: queries hang off *states* as their declared data
needs — a state subscribes, the data layer decides when HTTP happens —
which is the same write/read asymmetry recorded in § Where intents sit:
intents on edges, queries on nodes.

## Current state: half the abstraction, React-bound

How much of this exists today splits cleanly in two.

The **invariant half now holds in total**: every user-intent Pod write in
the UI goes through a named mutation hook — including the account actions
that were long the exceptions (§ The boundary cases). Beyond the writes,
the two user-invoked Pod *reads* (sharing audit, archive export) are
reified the same way — **imperative read-intents** on the `useMutation`
trigger primitive (`@operation query`, no invalidations): a category that
existed unrecognized all along (audit, export, the wipe preview, the
restore preview, the geocode lookup) in the blind spot of the
reads-are-declarative / writes-are-imperative dichotomy. Subscriptions
live on state nodes and stay out of the catalog; user-invoked one-shot
reads are intents on edges. The direct service calls remaining in the UI
layer are exactly the preview reads inside confirmation flows and pure
helpers.
The one reconciliation write that used to sit in a page load path — the
standalone view page auto-materialising a missing snapshot — now lives
inside its query hook (`useViewDetail`), a documented seam alongside the
other two. The catalog's boundary and the code's boundary agree.

The **reified half does not exist**: the per-intent metadata is uneven (the
hooks migrated through the dialog-write unification carry `meta.action`;
the older hooks own their invalidations but declare no label, parameters,
or mechanism), and nothing is enumerable — the catalog can be read off
`mutations.ts` by a person, not walked by a program. That is the missing
table.

The deeper limit: **the intent layer is React-bound.** An intent is
invokable only as a hook inside a component tree. Every non-React caller
the project already has — the benchmark seeder, the Tier-2 headless
runner — must drop below the layer and compose service functions directly.
The bench seeder is today's closest thing to an external intent caller,
and the abstraction is structurally unavailable to it; it re-states each
intent's service composition by hand.

The consequence for the registry: invokability-outside-React is not an
add-on but a restructuring. The intent's core — the service composition
plus its effect metadata — would have to live below the hook as plain data
and functions, with the hook reduced to a thin React adapter that binds
the core to the mutation cache (busy state, error routing, invalidation —
the parts that only mean something where a query cache exists). Then a
palette, a deep link, a tool call, and a headless runner share the same
entry point the dialogs use, and the table is its natural index.

## Open questions

- Is the goal an internal tightening (the registry as the single source of
  truth the dialogs and hooks both derive from) or an external surface
  (palette, deep-linkable actions, automation/LLM tools)? The registry is the
  prerequisite either way.
- Where would the registry live — a TS table next to `mutations.ts`, or RDF
  in `vocab/` (the intents as described resources, matching how everything
  else in the app is modeled)? The schema argument above favors `vocab/`.
- Who is the schema authority — are the intent shapes app-local terms, or
  terms other Solid energy apps could conform to (a shared intents
  vocabulary alongside building/consumption/core)? Conformance would need a
  stated mechanism (a shape language or a documented contract), since there
  is no compiler and no central model in the Solid setting.
- What is the unit of an intent for compound flows (add-buildings is one
  intent wrapping many writes) — the hook boundary already answers this,
  but an external surface must commit to it. Concrete instance:
  `useShareBuilding` accepts `recipients[]` and loops internally — one
  grant event, ACL entry and notification per recipient — while the
  catalog signature and the drafted ShEx shape say exactly-one recipient.
  So the hook is a *batch* of intent invocations; the registry must either
  say so or admit the plural into the shape.
- The table half of read-intents is settled (the `effect`-discriminated
  union, with entries for the two implemented hooks); open is the RDF
  half: a sibling class (`int:ReadIntent` beside `int:Intent`) or one
  class with an `int:effect` property — and whether an embedded
  confirmation preview (`listContainedResources`, entry-less because it
  has no affordance of its own) must nonetheless be a registered
  read-intent so `confirmation.preview` always references a catalog
  name.
- Does the affordance map become the third registry artifact (catalog,
  shapes, affordances), and is it drift-testable the same way — every
  intent reachable through at least one affordance, every affordance
  referencing a registered intent and binding only parameters its shape
  declares? The per-state half (which route/dialog states exist) is
  partially pinned by the URI-state spec already; the per-edge half exists
  only as JSX today.

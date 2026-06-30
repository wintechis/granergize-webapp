# Intents — the object-model interface and its front doors

Every *action* the app can take is a named, typed **intent**. The intent layer is the
single object-model interface over the data: the UI's hooks, deep links, the command
palette, the natural-language box, and the headless test runner all reach the **same**
dispatch, so no two surfaces can offer different capabilities. This note describes the
catalogue, how intents are parameterised, and the front doors that invoke them. Companion
to [`object-model.md`](./object-model.md) (the typed *objects* these verbs act on),
[`queries-mutations.md`](./queries-mutations.md) (the read/write taxonomy the intents obey),
[`query-layer.md`](./query-layer.md) (where a read intent's result comes from) and
[`building-detail.md`](./building-detail.md) (the affordance surfaces an intent appears on).

## The anatomy of one intent

Each verb is one named unit with four declared parts — take "share this building"
(`ShareBuilding`, surfaced reactively by `useShareBuilding`):

- *name + label* — the human action ("share the building"), which the central error toast
  phrases as `"Failed to {action}: …"`; a verb whose dialog shows its own inline error is
  marked *silent* instead.
- *parameters* — the typed argument object (here: the building IRI, the recipient WebIDs,
  whether energy is included, which years), declared as in *Typed parameters* below.
- *effect* — the Pod write it commits (here: a per-recipient grant + a `shared-out/` log
  append), reusing the service write with its optimistic locking.
- *invalidations* — the read keys it refreshes afterwards, which the verb **owns** (no
  caller wiring).

## The catalogue and the one dispatch

Each intent is a **React-free core** — a function of `(gateway, params)`, no `getSession()`,
no component tree — registered in `src/intents/registry.ts`. Following
Command–Query Separation the registry has two halves:

- **reads** (`READ_CORES`, dispatched by `query(name, params, gateway)`) return a *value*
  — `FindBuildings`, `GetBuilding`, `GetObservationYear`, `FindNearbyInstallations`,
  `FindRegionalStatistics`, `WhoHasAccess`, `SharedWithMe`, `ExportArchive`, and the
  dev-mode audits (`AuditGrants`, `CheckObservationLinks`);
- **writes** (`WRITE_CORES`, dispatched by `invoke(name, params, gateway)`) return an
  *outcome* — the building / observation / attachment / aggregation / sharing / room /
  agent / organisation / account verbs.

Because the core is the only place the work lives, every caller — a React hook, a deep
link's resolver, the palette, the LLM translator, a Tier-2 runner — is a thin front door
over `query`/`invoke`. The React hooks (`src/hooks/mutations.ts`) are the reactive adapter:
a mutation hook's body is `invoke("{Name}", params, gateway)` plus the cache invalidations
it **owns** (no caller wiring); a read core is reached imperatively (`query`) or shares the
warm cache through the peeks in [`query-layer.md`](./query-layer.md).

## Typed parameters

An intent's signature is declared in `src/intents/params.ts` (`INTENT_PARAMS`), RDF-typed
so the same schema drives the UI form, validation, and the LLM tool spec. Each parameter is:

nodeKind
: `iri` — a resolvable reference (resolved to its instance before invoke); or `literal` —
  a pass-through value.

range
: for an `iri` param, the RDF class it points at (`rec:Building`, `foaf:Agent`,
  `ldp:Resource`, …); for a `literal`, the XSD datatype (`xsd:string`, `xsd:boolean`,
  `xsd:gYear`, `xsd:decimal`).

cardinality
: `one` (required single) · `optional` (0–1) · `many` (required ≥1) · `any` (0+).

A compile-time witness ties this schema to the core's TypeScript params, so adding or
renaming a param breaks the *build* rather than drifting silently. An `iri`-kind argument
is turned into its instance by the **EntityQuery** resolver (`src/intents/entityQuery.ts`,
`resolve(entity, {iri}, gateway)` — `building` via the same fetch+parse the hooks use,
`aggregation` via the by-id read), so a deep link / palette / LLM tool can hand an IRI and
get the typed object plus its applicable verbs without a component tree.

## Where an intent surfaces — affordances

Which verbs an object offers is computed, not hand-placed: `src/intents/affordances.ts`
maps each intent to a state guard (`isOwnBuilding`, `hasEnergy`, `hasAttachments`,
`devOnly`, `always`, …), and `applicableIntents(object, viewer)` filters the catalogue to
the verbs that object affords this viewer. The per-object action menu **and** the command
palette read that same resolver, so they can never disagree about what a building (say) can
do right now.

## The command palette — three input modes

The palette (⌘K) is the keyboard front door; its single text field has three modes, keyed
by the first character:

- **plain text** — fuzzy search over navigation targets and the applicable verbs. A
  param-less write fires directly; a param-ful verb either routes to its **bespoke dialog**
  (a `{ref}`/`?action=` deep link that auto-opens it) or opens the **schema-driven form**
  (`IntentParamForm`, which renders one field per parameter from its `range` — a building
  picker, an agent picker, a year-chip input, a boolean switch, a text box — and submits
  the collected values straight to `invoke`/`query`).
- **`{`-prefixed** — a **JSON launcher**: a pasted `{ "name": "{intent}", "params": {…} }`
  is parsed, its `iri` params resolved (a `building` given as a name/address is looked up to
  its IRI), validated, and dispatched — a read renders its result inline, a write commits, a
  navigation pushes the route.
- **`>`-prefixed** — **natural language** (next section), which produces the JSON the
  launcher mode then runs.

## Natural-language → intent

`src/intents/llm/intentTranslate.ts` (`translateToIntentJson`) is the front half of
paste-and-launch: it turns a sentence into a `{ name, params }` object. The defining choice
is that its **system prompt is rendered from the live catalogue** (`INTENTS` +
`INTENT_PARAMS`, plus the `FindBuildings` selector vocabulary) — the model's tool schema
*is* the intent catalogue, so it cannot drift from the code.

- **Transport** — an OpenAI-compatible chat endpoint (`VITE_LLM_API_URI`, defaulting to the
  FAU NHR gateway; model and key via `VITE_LLM_*`, env-overridable). `response_format:
  json_object` forces JSON-only output; reasoning/thinking is disabled and the temperature
  low (deterministic, no token runaways); the fetch is bounded by a timeout with a single
  retry on a transient failure. Shipping a key to the browser is accepted for a
  dev/research endpoint (the weather-adapter proxy pattern is the swap if a production key
  ever needs hiding).
- **Review, never auto-fire** — the translated JSON lands in the launcher field for the
  user to read and confirm with Enter; validation and a wrong-guess catch happen at the
  launcher, not the translator. The same transport is the intended capture step for a
  future "extract building fields from an arbitrary attachment" branch (still a sketch).

## The through-line

The catalogue is the typed verb set; the parameters are RDF-typed so one schema serves the
form, the validator, and the LLM; and the four front doors — the affordance menus, the
hooks, the palette form/launcher, and the NL box — are all thin adapters over one
`query`/`invoke` dispatch. A capability added as a core appears, by construction, on every
surface at once.

# Exploration — moving work off the client

Two thought experiments about relocating the client boundary, recorded for the
rationale rather than as committed work. Neither is adopted; both are kept because
they share one constraint that any future restructuring runs into, and naming that
constraint once is the point of the note.

Companion to [`architecture.md`](./architecture.md) (the present client layering these
would change) and [`explore-intent-registry.md`](./explore-intent-registry.md) (the intent
layer the first experiment builds on).

## The shared constraint: credentials live in the browser

The app authenticates the user *directly* against their Solid identity provider, and
every Pod request is signed in the browser with a DPoP-bound session — proof of
possession tied to a key the browser holds so the token cannot be replayed by a third
party. There is deliberately no intermediary that can read or write a user's Pod. That
is not an implementation detail; it is the Solid premise the project rests on.

Both experiments below try to move work off the client, and both hit the same wall: the
moment a *server* needs to read or write the user's Pod data, it has to act as the user,
which means it must hold delegated credentials (becoming a trusted intermediary that sees
every user's data in cleartext) or be handed the browser's session (fighting the
point of proof-of-possession). So the boundary can move freely for **pure computation
over bytes the client already fetched**, but not for **credentialed Pod I/O** — that part
stays client-side as long as the no-intermediary premise holds.

## Experiment 1 — server-side intent layer, JSON-RPC to the client

The premise: once every user-intent write goes through a mutation hook and every read
through a query hook (the command/query split in
[`queries-mutations.md`](./queries-mutations.md)), the app already talks to its data
layer in verbs — `shareBuilding(...)`, `addEnergyYear(...)`, `useBuildings()`. Those are
RPC method signatures that have not been serialized yet. Finishing the intent layer is
exactly what turns that boundary into a clean cut: the hook bodies become
`POST {method, params}` calls, and everything below them — `TurtleParsingService`, the
`interop`/`aggregation` services, n3 parsing and serialization — moves server-side. The
React app shrinks to auth, routing, the React-Query cache, and rendering.

Mechanically this is straightforward; the intent layer is the natural seam. What it costs
is decided by the credential constraint, not by the code:

- A server doing the Pod I/O must act as the user — the trusted-intermediary problem
  above. This contradicts "data lives in user-controlled Pods with no middleman".
- Keeping the session in the browser and passing its token to the server per call is
  possible but fights DPoP's proof-of-possession and still inserts an intermediary.
- A per-user component the user controls (an edge function colocated with their Pod, a
  personal agent) keeps the trust model — but then it is not one central JSON-RPC
  backend, it is N user-controlled ones, a much larger design.

The version that survives the constraint is a **stateless, credential-free** RPC server:
it never holds Pod credentials, the browser still authenticates and signs Pod requests,
and the server only does pure transforms — parse Turtle into typed JSON, compute
views/benchmarks, serialize XLSX — over bytes the client feeds it. That sheds the heavy,
bundle-bloating code (n3, exceljs, parsing) without becoming an intermediary. The
genuinely Pod-touching intents (sharing, ACL rebuild, mutations) stay client-side because
those are the ones that need the user's credentials. Pure-compute-to-server is nearly
free; credentialed-I/O-to-server is the line to think hard before crossing.

## Experiment 2 — getting away from the SPA

"SPA" (single-page app) here is its strongest form: the server ships one HTML shell plus
a JS bundle, and from then on JavaScript owns routing, fetching, and rendering, with
`HashRouter` putting even the route after `#` beyond any server's view. "Getting away"
splits into three independent axes, with very different answers:

- **URLs / navigation** — real paths instead of `#/building/x`, native back/forward and
  deep links.
- **Where rendering happens** — a server emitting HTML per page (MPA / SSR) versus the
  client building the DOM.
- **Framework weight** — shipping less or no React.

The rendering axis runs straight into the shared constraint: any server that renders a
page *from the user's Pod data* needs the user's credentials, so classic multi-page
rendering, server-side rendering, and hypermedia-over-the-wire (server returns HTML
fragments) all require the intermediary this project avoids. The alternatives that
survive Solid are the ones where data is still fetched client-side but the shell stops
being one monolith — a ladder from cheapest to most radical:

- **Fix routing only.** Swap `HashRouter` for real-path routing. Nearly free in code, but
  the `scp dist/` deploy to a host subpath needs an SPA-fallback rewrite (unknown path →
  `index.html`). Still a full SPA; only the URLs improve.
- **Islands / build-time multi-page (Astro-style).** One real HTML document per route,
  built ahead of time, shipping almost no JS and "hydrating" only the interactive
  islands — the Leaflet map, the Recharts charts. Each page is a document the browser
  navigates to; the framework survives only inside islands. Data is still fetched
  client-side, so the credential model is untouched. This is the sweet spot for *less JS
  plus real documents* without changing the trust model; the cost is a different
  build/framework and redistributing the route logic across page files.
- **The Solid-native reframe.** Solid is the Web: every resource is an IRI and you
  navigate by following links. An SPA fights that by collapsing dozens of dereferenceable
  resources into one opaque app with no per-resource identity. The un-SPA form is a thin
  viewer over linked documents — a route per resource IRI, generic RDF rendering plus
  per-type views (a building IRI renders as the detail page, a view as its chart),
  navigation as following IRIs. This is the lineage of the older Solid data browsers, with
  domain-specific renderers. Maximally un-SPA in spirit even though still client-side JS:
  the app becomes a function over resources rather than a stateful application that reads
  resources. It is also the biggest rebuild and changes what the product *is* — a
  Linked-Data viewer, not a webapp — which aligns with the education/Linked-Data mandate
  better than anything else here.

The choice is really about which axis itches. Ugly URLs → fix routing. "Too much JS, pages
are not real pages" → islands. "This should feel like the Web, not an application" →  the
resource-oriented viewer. What none of them escape is the constraint: the dynamic,
per-user, credentialed data must be fetched and rendered client-side. The *single-page*
part (one shell, hash routing, monolithic bundle) can be shed freely; *client-side
rendering* cannot be shed without reopening Experiment 1's credentials question. Getting
away from the SPA is achievable; getting away from client-side rendering is Experiment 1
wearing a hat.

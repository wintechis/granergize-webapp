/**
 * The **port** (Clean-Architecture sense) the intent cores + Pod services depend
 * on instead of @inrupt's full `Session`: the minimal Solid surface they use —
 * the authed transport (`fetch`) and the viewer's identity (`webId`). A
 * core/service names `PodGateway`, an interface the app OWNS, never the framework
 * type; so the same code runs under a real login, a Tier-2 headless runner, the
 * bench seeder, or an LLM tool, each supplying its own gateway.
 *
 * The shape is FLAT (`webId`, not `info.webId`) and `webId` is REQUIRED, so a raw
 * @inrupt `Session` does NOT satisfy it. That is deliberate: the Session→gateway
 * conversion happens at the explicit composition root ({@link sessionGateway},
 * reached via `getGateway()` in `hooks/session.ts`), so the dependency boundary is
 * visible rather than implicit. Headless callers build one with {@link podGateway}.
 *
 * It is the app-wide **authed entry point**, not an intent-layer detail: every
 * read/write of the user's Pod threads a `PodGateway` — the React Query hooks
 * (`hooks/queries.ts`, `hooks/mutations.ts`), the data layer
 * (`TurtleParsingService`, the `rdf/` parsers/serializers, `fetchFresh`), the
 * `interop/`/`aggregation/` services, and the intent cores all take it as their
 * transport. It is the **read/write authed peer** of the read-only, identity-free
 * {@link ../sources/sourceGateway.ts | SourceGateway} (which carries no `webId` and
 * is reached ambiently — see that module for why the two differ).
 */
import type { Session } from "@inrupt/solid-client-authn-browser";

export interface PodGateway {
  /** The authed (instrumented + retrying) transport — @inrupt `Session.fetch`. */
  readonly fetch: typeof globalThis.fetch;
  /** The viewer's WebID (the authed identity). */
  readonly webId: string;
}

/**
 * Adapt an @inrupt `Session` into the port — the one place the framework type is
 * unwrapped, called at the app's entry points (`getGateway()` / `Login` / `main`).
 * The caller guarantees a logged-in session (every entry point gates on auth), so
 * the WebID is asserted present.
 */
export function sessionGateway(session: Session): PodGateway {
  return { fetch: session.fetch, webId: session.info.webId! };
}

/**
 * Build a gateway for a headless caller that holds a bare authed `fetch` + WebID
 * (a Tier-2 runner, the bench seeder, an LLM tool) rather than a `Session`.
 */
export function podGateway(
  fetch: typeof globalThis.fetch,
  webId: string,
): PodGateway {
  return { fetch, webId };
}

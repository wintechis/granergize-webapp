import {
  getDefaultSession,
  type Session,
} from "@inrupt/solid-client-authn-browser";
import { type PodGateway, sessionGateway } from "../services/pod/podGateway.ts";

let override: Session | null = null;

/**
 * The active Solid session for the data hooks. Defaults to the
 * `@inrupt/solid-client-authn-browser` singleton; tests can substitute a fake
 * (offline-fixture) session via {@link _setSessionForTesting} — mirrors the
 * `_setStorageRootForTesting` seam in solidUtils.
 */
export function getSession(): Session {
  return override ?? getDefaultSession();
}

/** Test seam: override (or clear, with null) the session the hooks use. */
export function _setSessionForTesting(session: Session | null): void {
  override = session;
}

/**
 * The composition root: the active session adapted into the {@link PodGateway}
 * port the data layer depends on. This is where the @inrupt `Session` is unwrapped
 * — hooks AND components call `getGateway()` (never `sessionGateway(session)`
 * by hand) when handing the transport to a query/mutation/intent/service, so
 * the framework type never crosses into the data layer and the composition
 * happens in exactly one place. Only auth-flow code (`Login`/`main.tsx`) and
 * the WebID read (`webIdOf`) still touch the raw `Session`.
 */
export function getGateway(): PodGateway {
  return sessionGateway(getSession());
}

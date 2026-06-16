// Intent core (React-free) for SeedDemoBuildings. See ./README.md. A dev-mode
// seeder: per-building best-effort (the service swallows per-building failures and
// returns the seeded count + the attempted total), so the outcome is a tally.
import type { Session } from "@inrupt/solid-client-authn-browser";
import { seedDemoBuildings } from "../services/rdf/building/buildingSerializer.ts";
import type { Tally } from "./outcomes.ts";

/**
 * React-free core of {@link import("../hooks/mutations.ts").useSeedDemoBuildings}:
 * seed the fixed demo building set (per-building best-effort). Reads the WebID off
 * the session (throws if absent — the buildings are attributed to it) and returns a
 * tally `{done, total}` mapped from the service's `{seeded, total}`. Paramless
 * (collection-wide); the adapter wraps it `(s, _p)` to keep the arity uniform.
 */
export async function seedDemoBuildingsCore(session: Session): Promise<Tally> {
  const webId = session.info.webId;
  if (!webId) throw new Error("Not authenticated");
  const { seeded, total } = await seedDemoBuildings(session, webId);
  return { done: seeded, total };
}

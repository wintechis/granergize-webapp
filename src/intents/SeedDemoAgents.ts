// Intent core (React-free) for SeedDemoAgents. See ./README.md. A dev-mode
// seeder: per-contact best-effort (the service swallows per-contact failures and
// returns the seeded count + the attempted total), so the outcome is a tally.
import type { PodGateway } from "../services/pod/podGateway.ts";
import { seedDemoAgents } from "../services/demoConnect.ts";
import type { Tally } from "./outcomes.ts";

/**
 * React-free core of {@link import("../hooks/mutations.ts").useSeedDemoAgents}:
 * seed the demo contacts (per-contact best-effort). Returns a tally `{done, total}`
 * mapped from the service's `{seeded, total}`. Paramless (collection-wide); the
 * adapter wraps it `(s, _p)` to keep the `(gateway, params)` arity uniform.
 */
export async function seedDemoAgentsCore(gateway: PodGateway): Promise<Tally> {
  const { seeded, total } = await seedDemoAgents(gateway);
  return { done: seeded, total };
}

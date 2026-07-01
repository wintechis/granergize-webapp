// Intent core (React-free) for DeclineDemoOffer (the hook is
// `useDeclineDemoOffer`). See ./README.md for the core/adapter split and the
// write→outcome convention.
import type { PodGateway } from "../../../services/pod/podGateway.ts";
import { setDemoSeedDeclined } from "../../../services/prefs.ts";
import type { Settled } from "../../outcomes.ts";

/**
 * React-free core of {@link import("../hooks/mutations.ts").useDeclineDemoOffer}:
 * persist that the user declined the fresh-Pod demo-buildings offer
 * (`prefs.ttl` `gran:demoSeedDeclined`), so the onboarding banner stays down
 * across reloads. The adapter owns the invalidation (prefs + the demo-offer
 * probe — the cached offer must stand down without a reload).
 */
export async function declineDemoOfferCore(
  gateway: PodGateway,
): Promise<Settled> {
  await setDemoSeedDeclined(gateway, true);
  return { ok: true };
}

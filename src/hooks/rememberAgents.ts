import type { Session } from "@inrupt/solid-client-authn-browser";
import type { QueryClient } from "@tanstack/react-query";
import { rememberAgent } from "../services/contacts.ts";
import { queryKeys } from "./queries.ts";

/**
 * Auto-remember a building's WebID agents (operator / owner / investor /
 * facility manager / developer / consultant) in the
 * address book (fire-and-forget), then refresh the contacts query so the new
 * contacts appear without a reload (the direct `rememberAgent` write bypasses
 * the addContact mutation's invalidation). Only real WebIDs — a legacy literal
 * value an older Pod may carry in these fields is skipped.
 *
 * `refetchType: "all"` is load-bearing: the contacts query is INACTIVE while a
 * building dialog is open (Connect is unmounted), so a default invalidate would
 * only mark it stale — and the app's `refetchOnMount: false` then suppresses
 * the refetch when Connect mounts, leaving a stale list. Refetch the inactive
 * query now so the new contacts are already present when Connect mounts.
 *
 * Shared by the Add and Edit building dialogs (it was copy-pasted, comment and
 * all).
 */
export function rememberBuildingAgents(
  session: Session,
  qc: QueryClient,
  fields: Record<string, string | undefined>,
): void {
  const agentWebIds = [
    fields.operatedBy,
    fields.ownedBy,
    fields.investor,
    fields.facilityManagedBy,
    fields.developedBy,
    fields.consultedBy,
  ]
    .filter((w): w is string => typeof w === "string" && /^https?:\/\//.test(w));
  if (agentWebIds.length === 0) return;
  void Promise.all(agentWebIds.map((w) => rememberAgent(session, w)))
    .then(() =>
      qc.invalidateQueries({ queryKey: queryKeys.contacts, refetchType: "all" })
    );
}

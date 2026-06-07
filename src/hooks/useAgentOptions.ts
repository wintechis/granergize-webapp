import { useContacts, useRoomState } from "./queries.ts";

/**
 * Unique WebID suggestions for agent entry: the personal address book plus the
 * current data room's members. Both are already-cached React Query reads, so this
 * adds no fetch. Used by `<AgentField>` and the share dialog's recipient picker.
 */
export function useAgentOptions(): string[] {
  const contacts = useContacts().data ?? [];
  const members = useRoomState().data?.members ?? [];
  return [
    ...new Set([
      ...contacts.map((c) => c.webId),
      ...members.map((m) => m.webId),
    ]),
  ];
}

import type { BuildingType } from "../../types.ts";

/**
 * The building fields that reference a party (a WebID or a free-text name):
 * customer / operatedBy / investor, plus the provenance `attributedTo`. These are
 * the surfaces an agent appears on, and what the contact detail view lists.
 */
export const AGENT_ROLES: Array<{ field: keyof BuildingType; label: string }> = [
  { field: "customer", label: "Customer" },
  { field: "operatedBy", label: "Operated by" },
  { field: "investor", label: "Investor" },
  { field: "attributedTo", label: "Data source" },
];

/** A building this agent is referenced by, with the role(s) it fills there. */
export interface Appearance {
  building: BuildingType;
  roles: string[];
}

/**
 * Buildings where any agent field equals `webId`, each tagged with the matching
 * role label(s). Pure selector over already-loaded buildings — no fetch.
 */
export function appearancesOf(
  webId: string,
  buildings: BuildingType[],
): Appearance[] {
  const out: Appearance[] = [];
  for (const building of buildings) {
    const roles = AGENT_ROLES
      .filter((r) => building[r.field] === webId)
      .map((r) => r.label);
    if (roles.length > 0) out.push({ building, roles });
  }
  return out;
}

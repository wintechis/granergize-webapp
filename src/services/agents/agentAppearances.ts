import type { BuildingType } from "../../types.ts";

/**
 * The building fields that reference a party (a WebID or a free-text name): the
 * full set of `foaf:Agent`-valued roles from `buildingConfig` (ownedBy /
 * operatedBy / facilityManagedBy / developedBy / consultedBy / investor /
 * customer), plus the provenance `attributedTo`. These are the surfaces an agent
 * appears on, and what the contact detail view lists — kept in step with the
 * agent-valued fields so a party referenced in any role is found here.
 */
export const AGENT_ROLES: Array<{ field: keyof BuildingType; label: string }> = [
  { field: "ownedBy", label: "Owned by" },
  { field: "operatedBy", label: "Operated by" },
  { field: "facilityManagedBy", label: "Facility management" },
  { field: "developedBy", label: "Developed by" },
  { field: "consultedBy", label: "Consulted by" },
  { field: "investor", label: "Investor" },
  { field: "customer", label: "Customer" },
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

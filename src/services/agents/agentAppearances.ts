import type { BuildingType, SystemKind } from "../../types.ts";
import type { Tier } from "../../constants/tiers.ts";

/**
 * The building fields that reference a party (a WebID or a free-text name): the
 * full set of `foaf:Agent`-valued roles from `buildingConfig` (ownedBy /
 * operatedBy / facilityManagedBy / developedBy / consultedBy / investor /
 * customer), plus the provenance `attributedTo`. These are the surfaces an agent
 * appears on, and what the agent detail view lists — kept in step with the
 * agent-valued fields so a party referenced in any role is found here.
 *
 * A party can also operate a building's **technical system** (`<#pv>`/`<#chp>`/… —
 * the Anlagenbetreiber, distinct from the building's operator), recorded as
 * `rec:operatedBy` on the system node, not the building. Those are gathered
 * separately from `building.systems[].operatedBy` (see below) — that's where the
 * bulk-imported plant operators live.
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

/** Role label for an agent that operates a building's technical system. */
const SYSTEM_OPERATOR_LABEL: Partial<Record<SystemKind, string>> = {
  pv: "PV operator",
  chp: "CHP operator",
  battery: "Battery operator",
};
const systemOperatorLabel = (kind: SystemKind): string =>
  SYSTEM_OPERATOR_LABEL[kind] ?? "System operator";

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
    // A party may also operate one of the building's technical systems (the
    // Anlagenbetreiber on a `<#pv>`/`<#chp>`/… node), distinct from the building's
    // own operator — tag each such system with its operator role.
    for (const sys of building.systems ?? []) {
      if (sys.operatedBy === webId) roles.push(systemOperatorLabel(sys.kind));
    }
    if (roles.length > 0) out.push({ building, roles });
  }
  return out;
}

/**
 * Distinct **WebID/IRI-valued** agents referenced across the loaded buildings — the
 * union of every {@link AGENT_ROLES} field that holds an IRI PLUS every technical
 * system's `operatedBy` (the Anlagenbetreiber on a `<#pv>`/`<#chp>`/… node), where
 * the bulk-imported plant operators live. A free-text operator name is not a
 * resolvable agent, so it's excluded. This is the "referenced" tier of the Agents
 * finder: parties that appear in your data but aren't (yet) in your address book. A
 * pure selector over already-loaded buildings — no fetch.
 */
export function referencedAgentWebIds(buildings: BuildingType[]): string[] {
  return [...new Set(buildings.flatMap(agentWebIdsOf))];
}

/** The distinct WebID/IRI agents one building references — every {@link AGENT_ROLES}
 * field that holds an IRI plus each technical system's `operatedBy`. Free-text names
 * are excluded (not resolvable agents). The per-building primitive
 * {@link referencedAgentWebIds} and {@link referencedAgentTiers} build on. */
export function agentWebIdsOf(building: BuildingType): string[] {
  const out: string[] = [];
  const add = (value: string | undefined) => {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) out.push(value);
  };
  for (const { field } of AGENT_ROLES) {
    const value = building[field];
    if (typeof value === "string") add(value);
  }
  for (const sys of building.systems ?? []) add(sys.operatedBy);
  return out;
}

/**
 * Each referenced agent's **provenance tier(s)**, derived from the buildings it
 * appears in: an agent referenced by an OWN building is `mine`, one referenced by a
 * building shared WITH you is `shared` (an agent in both is both). The agent's own
 * address-book membership (`saved` → `mine`) is layered on by the caller. Pure
 * selector over already-loaded buildings — the Agents finder's source facet.
 */
export function referencedAgentTiers(
  buildings: BuildingType[],
): Map<string, Set<Tier>> {
  const map = new Map<string, Set<Tier>>();
  for (const building of buildings) {
    const tier: Tier = building.isShared ? "shared" : "mine";
    for (const webId of agentWebIdsOf(building)) {
      const set = map.get(webId) ?? new Set<Tier>();
      set.add(tier);
      map.set(webId, set);
    }
  }
  return map;
}

import type { UserRole } from "../../types/types.ts";
import { GRAN_NS } from "../services/utils/vocabularies.ts";

/** Human-readable labels for the provenance category / membership roles. */
export const ROLE_LABELS: Record<string, string> = {
  dummy: "Dummy",
  investor: "Investor",
  user: "User",
  benchmark_service_provider: "Benchmark Service Provider",
};

/** Roles a user can self-assign in a data room (excludes the internal "dummy"). */
export const ROOM_ROLE_OPTIONS: UserRole[] = [
  "investor",
  "user",
  "benchmark_service_provider",
];

/**
 * Provenance category (a {@link UserRole} value) ↔ the gran: IRI used as the
 * `prov:hadRole` of a building's `prov:qualifiedAttribution`. The IRIs are reused
 * from the legacy `gran:dataSourceRole` values so old pods read back unchanged.
 */
export const PROVENANCE_TO_IRI: Record<UserRole, string> = {
  dummy: `${GRAN_NS}DummyRole`,
  investor: `${GRAN_NS}InvestorRole`,
  user: `${GRAN_NS}UserRoleInstance`,
  benchmark_service_provider: `${GRAN_NS}BenchmarkRole`,
};

export const IRI_TO_PROVENANCE: Record<string, UserRole> = Object.fromEntries(
  Object.entries(PROVENANCE_TO_IRI).map(([role, iri]) => [iri, role as UserRole]),
) as Record<string, UserRole>;

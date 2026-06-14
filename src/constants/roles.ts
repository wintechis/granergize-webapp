import type { UserRole } from "../types.ts";
import { GRAN_NS } from "../services/rdf/vocabularies.ts";

/** Human-readable labels for the data-room membership roles. */
export const ROLE_LABELS: Record<string, string> = {
  dummy: "Dummy",
  investor: "Investor",
  user: "User",
  benchmark_service_provider: "Benchmark Service Provider",
  facility_manager: "Facility Manager",
  developer: "Developer",
  consultant_broker: "Consultant / Broker",
  software_provider: "Software Provider",
  energy_provider: "Energy Provider",
};

/** Roles a user can self-assign in a data room (excludes the internal "dummy"). */
export const ROOM_ROLE_OPTIONS: UserRole[] = [
  "investor",
  "user",
  "benchmark_service_provider",
  "facility_manager",
  "developer",
  "consultant_broker",
  "software_provider",
  "energy_provider",
];

/**
 * Data-room membership role (a {@link UserRole} value) ↔ the `gran:…Role` IRI
 * written as the `sioc:has_function` of a membership event (see `dataRoom.ts`). The
 * role names the role of the organisation a member represents.
 */
export const MEMBERSHIP_ROLE_TO_IRI: Record<UserRole, string> = {
  dummy: `${GRAN_NS}DummyRole`,
  investor: `${GRAN_NS}InvestorRole`,
  user: `${GRAN_NS}UserRoleInstance`,
  benchmark_service_provider: `${GRAN_NS}BenchmarkRole`,
  facility_manager: `${GRAN_NS}FacilityManagerRole`,
  developer: `${GRAN_NS}DeveloperRole`,
  consultant_broker: `${GRAN_NS}ConsultantBrokerRole`,
  software_provider: `${GRAN_NS}SoftwareProviderRole`,
  energy_provider: `${GRAN_NS}EnergyProviderRole`,
};

export const IRI_TO_MEMBERSHIP_ROLE: Record<string, UserRole> = Object.fromEntries(
  Object.entries(MEMBERSHIP_ROLE_TO_IRI).map(([role, iri]) => [iri, role as UserRole]),
) as Record<string, UserRole>;

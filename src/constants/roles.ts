import type { UserRole } from "../types.ts";
import { GRAN_NS } from "../services/rdf/vocabularies.ts";

/** Human-readable labels for the provenance category / membership roles. */
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
 * Provenance category (a {@link UserRole} value) ↔ the gran: IRI used as the
 * `prov:hadRole` of a building's `prov:qualifiedAttribution`. The IRIs are reused
 * from the legacy `gran:dataSourceRole` values so old pods read back unchanged.
 */
export const PROVENANCE_TO_IRI: Record<UserRole, string> = {
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

export const IRI_TO_PROVENANCE: Record<string, UserRole> = Object.fromEntries(
  Object.entries(PROVENANCE_TO_IRI).map(([role, iri]) => [iri, role as UserRole]),
) as Record<string, UserRole>;

/**
 * Company *kind* (a {@link UserRole} value) ↔ the gran: IRI used as the
 * `org:classification` of the user's organisation node in the WebID profile —
 * what kind of company it is (e.g. a real-estate investor), NOT a role the
 * person plays. Deliberately distinct from {@link PROVENANCE_TO_IRI}: those
 * `…Role` IRIs name the producing *role* on a building's attribution, whereas
 * these name the org's classification concept. The producing role recorded on a
 * building is derived from the company kind via {@link PROVENANCE_TO_IRI}.
 */
export const COMPANY_KIND_TO_IRI: Record<UserRole, string> = {
  dummy: `${GRAN_NS}Dummy`,
  investor: `${GRAN_NS}Investor`,
  user: `${GRAN_NS}User`,
  benchmark_service_provider: `${GRAN_NS}BenchmarkServiceProvider`,
  facility_manager: `${GRAN_NS}FacilityManager`,
  developer: `${GRAN_NS}Developer`,
  consultant_broker: `${GRAN_NS}ConsultantBroker`,
  software_provider: `${GRAN_NS}SoftwareProvider`,
  energy_provider: `${GRAN_NS}EnergyProvider`,
};

export const IRI_TO_COMPANY_KIND: Record<string, UserRole> = Object.fromEntries(
  Object.entries(COMPANY_KIND_TO_IRI).map(([role, iri]) => [iri, role as UserRole]),
) as Record<string, UserRole>;

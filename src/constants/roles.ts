import type { UserRole } from "../../types/types.ts";

/** Human-readable labels for the data-source / membership roles. */
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

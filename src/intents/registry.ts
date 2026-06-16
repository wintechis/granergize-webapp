// The React-free object-model interface for the intent catalog: name → core
// dispatch with Command–Query Separation enforced at the TYPE level. See
// ./README.md §"The invoke / query layer".
//
// This module imports the cores + `Session` ONLY — no React, no `getSession`,
// no React Query — so a headless caller (a palette, a deep link, an LLM tool,
// the bench seeder, a Tier-2 runner) hits the same entry point the UI does.
import type { Session } from "@inrupt/solid-client-authn-browser";
import { shareBuildingCore } from "./shareBuilding.ts";
import { checkSharingConsistencyCore } from "./checkSharingConsistency.ts";
import { exportArchiveCore } from "./exportArchive.ts";

/**
 * Write-effect cores keyed by the catalog `name`. Only **extracted** cores are
 * keys; Step 5 adds one line each as the remaining hooks gain cores. A write core
 * returns an OUTCOME (settled / a small tally), never a value.
 */
export const WRITE_CORES = {
  ShareBuilding: shareBuildingCore,
} as const;

/**
 * Read-effect cores keyed by the catalog `name`. A read core returns its VALUE
 * (the audit report, the archive blob). `AuditGrants` ignores its params (the
 * audit is collection-wide); `(s, _p) => …` keeps every core's `(session, params)`
 * arity so the dispatch types stay uniform.
 */
export const READ_CORES = {
  // AuditGrants is collection-wide — it takes no params. Declaring the empty
  // param type keeps every read core's `(session, params)` arity uniform; the
  // arg is read once into `void` so the dispatch maps stay homogeneous.
  AuditGrants: (s: Session, p: Record<never, never>) => {
    void p;
    return checkSharingConsistencyCore(s);
  },
  ExportArchive: exportArchiveCore,
} as const;

/** A catalog name that has an extracted **write** core. */
export type WriteIntentName = keyof typeof WRITE_CORES;
/** A catalog name that has an extracted **read** core. */
export type ReadIntentName = keyof typeof READ_CORES;

/** The TS param type a write/read core accepts (Step 2's binding target). */
export type CoreParams<N extends WriteIntentName | ReadIntentName> =
  N extends WriteIntentName ? Parameters<(typeof WRITE_CORES)[N]>[1]
    : N extends ReadIntentName ? Parameters<(typeof READ_CORES)[N]>[1]
    : never;

/** The OUTCOME a write core resolves to. */
export type WriteOutcome<N extends WriteIntentName> = Awaited<
  ReturnType<(typeof WRITE_CORES)[N]>
>;

/** The VALUE a read core resolves to. */
export type ReadValue<N extends ReadIntentName> = Awaited<
  ReturnType<(typeof READ_CORES)[N]>
>;

/**
 * Thrown by {@link invokeByName}/{@link queryByName} when a name has no extracted
 * core — a **clear error, never a silent fallback** (a missing core is a Step-5
 * gap, not a recoverable condition). `kind` says which channel was asked.
 */
export class IntentNotInvocableError extends Error {
  constructor(
    readonly name: string,
    readonly kind: "write" | "read",
  ) {
    super(`Intent "${name}" has no extracted ${kind} core (not invocable yet)`);
    this.name = "IntentNotInvocableError";
  }
}

/**
 * Invoke a **write** intent by its statically-known catalog name. CQS is enforced
 * by the type: passing a READ name is a compile error (the name isn't a
 * {@link WriteIntentName}), so there is no runtime `effect` switch.
 */
export function invoke<N extends WriteIntentName>(
  name: N,
  params: CoreParams<N>,
  session: Session,
): Promise<WriteOutcome<N>> {
  const core = WRITE_CORES[name] as unknown as (
    s: Session,
    p: CoreParams<N>,
  ) => Promise<WriteOutcome<N>>;
  return core(session, params);
}

/**
 * Query a **read** intent by its statically-known catalog name. CQS is enforced
 * by the type: passing a WRITE name is a compile error.
 */
export function query<N extends ReadIntentName>(
  name: N,
  params: CoreParams<N>,
  session: Session,
): Promise<ReadValue<N>> {
  const core = READ_CORES[name] as unknown as (
    s: Session,
    p: CoreParams<N>,
  ) => Promise<ReadValue<N>>;
  return core(session, params);
}

/**
 * Dynamic write dispatch from a runtime string (the palette passing
 * `IntentEntry.name`). Throws {@link IntentNotInvocableError} for any name without
 * an extracted write core.
 */
export function invokeByName(
  name: string,
  params: unknown,
  session: Session,
): Promise<unknown> {
  if (!(name in WRITE_CORES)) {
    throw new IntentNotInvocableError(name, "write");
  }
  return invoke(
    name as WriteIntentName,
    params as CoreParams<WriteIntentName>,
    session,
  );
}

/**
 * Dynamic read dispatch from a runtime string. Throws
 * {@link IntentNotInvocableError} for any name without an extracted read core.
 */
export function queryByName(
  name: string,
  params: unknown,
  session: Session,
): Promise<unknown> {
  if (!(name in READ_CORES)) {
    throw new IntentNotInvocableError(name, "read");
  }
  return query(
    name as ReadIntentName,
    params as CoreParams<ReadIntentName>,
    session,
  );
}

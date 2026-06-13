/**
 * The Tier-3/4 e2e spec catalog, split by POD COUNT — the single source of truth
 * shared by `playwright.config.ts` (project `testMatch`) and the matrix launcher
 * `test/e2e-local/matrix.ts`.
 *
 * The split is load-bearing beyond project routing: the parallel-lane matrix
 * ANTI-PHASES the heavy multi-pod specs (`DUO_SPECS` + `TRIO_SPECS`) against the
 * light single-pod ones (`SOLO_SPECS`). Each backend lane runs the two groups in
 * the OPPOSITE order, so the multi-pod login bursts — several concurrent OIDC flows
 * each — never run on both lanes at the same wall-clock instant (the contention that
 * timed the sharing specs out when both lanes hit them together; the solo specs are
 * single-login and tolerate the overlap). Keep these as recursive globs (a leading
 * doublestar wildcard) so both consumers can use them directly: Playwright `testMatch`
 * and, after stripping that wildcard prefix, a `playwright test` positional file filter.
 */

/** SOLO — one pod (Alice): single-account specs. Light, single-login. */
export const SOLO_SPECS = [
  "**/login.spec.ts",
  "**/logout.spec.ts",
  "**/organisation.spec.ts",
  "**/add-building.spec.ts",
  "**/attachments.spec.ts",
  "**/edit-building-fields.spec.ts",
  "**/excel-import.spec.ts",
  "**/excel-export.spec.ts",
  "**/energy-entry.spec.ts",
  "**/energy-resolutions.spec.ts",
  "**/materialised-views.spec.ts",
  "**/map-energy-lens.spec.ts",
  "**/data-room.spec.ts",
  "**/building-details.spec.ts",
  "**/contacts.spec.ts",
  "**/archive-restore.spec.ts",
  "**/uri-state.spec.ts",
  "**/building-form-and-energy.spec.ts",
];

/** DUO — two pods (A = Alice + B = Bob): the cross-Pod sharing handshakes. */
export const DUO_SPECS = [
  "**/share-building.spec.ts",
  "**/share-view.spec.ts",
  "**/share-files.spec.ts",
];

/** TRIO — three pods (A + B + C = Charlie): the benchmark-service round-trip. */
export const TRIO_SPECS = [
  "**/peer-benchmark.spec.ts",
];

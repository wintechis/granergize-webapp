/**
 * Tier-aware e2e timeouts — one source of truth so specs don't hardcode budgets.
 *
 * A timeout only ever caps a FAILURE; it never slows a passing assertion (which
 * resolves the instant its condition holds). So these are sized to best-case +
 * margin, NOT worst-case: a broken test then fails in seconds, not minutes.
 *
 * Tier-aware: the local tier (Tier-3, throwaway CSS/JSS on localhost) is fast, so
 * the local budgets are tight; the remote tier (Tier-4, real Pods over the network,
 * some behind Cloudflare) gets the same budgets doubled via {@link t}. The scale is
 * fixed per run from `E2E_LOCAL` (set for Tier-3, unset for Tier-4).
 *
 * Backend-aware too: under the local tier, JSS gets extra headroom over CSS. Not
 * because JSS is slow per request (measured ~7ms/req — on par with CSS), but because
 * the heaviest specs make many sequential round-trips (e.g. the excel round-trip
 * deletes ~130 resources across recursive energy subtrees, each gated on a UI
 * confirmation + list refetch), and that orchestration runs measurably longer under
 * JSS — enough that a tight 30s inner `poll`/`action` budget flakes while the work is
 * still legitimately draining (confirmed: the delete phase spanned 59s with every
 * request answered, no stall). Scaling the budget only delays a FAILURE, never slows
 * a pass, so the extra headroom costs nothing on green runs. One place beats per-spec
 * `podServerKind()` timeout bumps.
 *
 * Categories (pick by INTENT, not by the old number):
 *  - `tiny`        a fixed micro-pause (`waitForTimeout`) — NOT tier-scaled.
 *  - `quick`       a near-immediate element/check (already-rendering UI).
 *  - `visible`     an element appearing after a local interaction.
 *  - `action`      a network-backed confirmation (toast, write settle, navigation).
 *  - `poll`        an `expect.poll` / `toPass` convergence loop.
 *  - `testSolo`    a solo (single-pod) test body budget (`test.setTimeout`).
 *  - `testSharing` a sharing (multi-pod) test body budget.
 *  - `setup`       a `beforeAll` hook budget (login + clean-start + demo seed chained).
 *  - `afterAll`    a teardown/wipe hook budget.
 *  - `login`       login (IdP + consent) — kept generous; real IdPs are slow/retried.
 *  - `longOp`      a deliberately long operation (bulk import, per-year share).
 */
const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
/** Tier-4 (real Pods) unless the local tier is on. */
const REMOTE = !ENV?.E2E_LOCAL;
/** Local tier against JSS (vs the default local CSS). */
const LOCAL_JSS = !REMOTE && ENV?.LOCAL_POD_SERVER === "jss";
/**
 * Scale a best-case LOCAL-CSS budget for the run's backend: ×2 for the remote tier
 * (network + Cloudflare), ×1.75 for local JSS (heavier multi-round-trip orchestration
 * — see the file header), ×1 for the fast local CSS baseline.
 */
const t = (localMs: number): number =>
  REMOTE ? localMs * 2 : LOCAL_JSS ? Math.round(localMs * 1.75) : localMs;

export const T = {
  tiny: 1_000,
  quick: t(8_000),
  visible: t(15_000),
  action: t(30_000),
  poll: t(30_000),
  testSolo: t(90_000),
  testSharing: t(150_000),
  setup: t(120_000),
  afterAll: t(60_000),
  login: t(90_000),
  longOp: t(180_000),
};

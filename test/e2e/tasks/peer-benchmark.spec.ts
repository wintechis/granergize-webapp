import { expect, test } from "@playwright/test";
import { account, ensureCompanyKind, webIdOf } from "../helpers/login.ts";
import { resolveAccounts } from "../../config/resolve.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { shareByWebId } from "../helpers/manage.ts";
import { receivedViews } from "../helpers/manage.ts";
import { freshPage } from "../helpers/twoPod.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * The BSP benchmarking round-trip "in practice" (browser, THREE throwaway Pods):
 *
 *   • C (the benchmark service provider) declares its company kind;
 *   • A and B (two investor owners) each share a DISTINCT investor building (with
 *     annual energy) to C — a BSP owns no buildings, it benchmarks the ones shared
 *     to it, and two different buildings make the average meaningful, not a copy;
 *   • C builds a benchmark VIEW from the shared-with-me roster (its picker shows
 *     BOTH contributors), computes it over both, and shares the snapshot back to the
 *     contributors via the "Add all contributors" affordance;
 *   • A's Energy view shows the returned Benchmark column ("Benchmark provided by …").
 *
 * Three roles A = Alice, B = Bob, C = Charlie — the same role model the other specs
 * use. The distinct-value averaging is proved exhaustively in the Tier-2 headless
 * `benchmark` task; this is the UI proof that two contributors flow into the BSP
 * create-view, the share-back affordance fans out to both, and the energy-tab
 * Benchmark column renders. Each role logs in fresh where it acts (so its inbox is
 * drained at login). Needs accounts A + B + C; skipped without them.
 */

const BENCH_VIEW = "E2E Benchmark";

const A = account("A");
const B = account("B");
const C = account("C");

// A BSP owns no buildings — it benchmarks buildings shared TO it. So the two
// owners seed the *investor* demo and each shares a DIFFERENT building (distinct,
// fixed energy → a meaningful, repeatable benchmark, not two identical copies).
const OWNERS = [
  { account: A, street: "Nordostpark 84" },
  { account: B, street: "Fürther Straße 244" },
];
const STREET = OWNERS[0].street; // A's building — asserted on A's energy view below

// Cross-Pod sharing needs interoperating providers (as in share-building); the
// pair check covers A+B, and C is seeded on the same local server in Tier 3.
const trio = resolveAccounts({ count: 3, slots: ["A", "B", "C"], interoperatingPair: true });

test.describe("peer benchmark round-trip (BSP)", () => {
  test.skip(!trio.ok, trio.ok ? "" : trio.reason);

  test("two owners share to the BSP; it benchmarks across both and an owner sees it", async ({ browser }) => {
    // Five sequential logins (C, A, B, C, A); give the multi-pod budget headroom.
    test.setTimeout(T.testSharing + 2 * T.login);

    // ── C declares the BSP company kind and we learn its WebID ──
    const c1 = await freshPage(browser, C);
    let cWebId = "";
    try {
      await ensureCompanyKind(c1.page, "benchmark_service_provider", { force: true });
      cWebId = await webIdOf(c1.page);
    } finally {
      await c1.ctx.close();
    }
    expect(cWebId, "C's WebID").toBeTruthy();

    // ── A and B each seed the investor demo and share a DISTINCT building (with
    //    energy) to C, so C benchmarks two different buildings, not two copies ──
    for (const owner of OWNERS) {
      const o = await freshPage(browser, owner.account);
      o.page.on("dialog", (d) => d.accept());
      try {
        await ensureDemoBuildings(o.page, "investor");
        await shareByWebId(o.page, owner.street, cWebId);
      } finally {
        await o.ctx.close();
      }
    }

    // ── C (fresh login drains its inbox) benchmarks across BOTH and shares back ──
    const c2 = await freshPage(browser, C);
    try {
      await c2.page.getByRole("tab", { name: "Manage" }).click();
      await c2.page.getByRole("button", { name: /create view/i }).click();
      const dlg = c2.page.getByRole("dialog");
      await expect(dlg).toBeVisible({ timeout: T.action });

      // The BSP role appears once the dialog has folded in the shared-with-me roster
      // (an async effect); re-open the Role select until "BSP" is offered.
      const roleSel = dlg.getByLabel("Role");
      await expect(async () => {
        await roleSel.click();
        const bsp = c2.page.getByRole("option", { name: "BSP", exact: true });
        try {
          await expect(bsp).toBeVisible({ timeout: T.visible });
          await bsp.click();
        } catch (e) {
          await c2.page.keyboard.press("Escape").catch(() => {});
          throw e;
        }
      }).toPass({ timeout: T.poll });

      await dlg.getByLabel("View Name").fill(BENCH_VIEW);

      // Both owners' buildings must be offered — one shared from A's Pod, one from
      // B's — proving two contributors reached the BSP. Select them all.
      await dlg.getByLabel("Select Buildings").click();
      const options = c2.page.getByRole("option");
      await expect(async () => {
        expect(await options.count()).toBe(2);
      }).toPass({ timeout: T.poll });
      const n = await options.count();
      for (let i = 0; i < n; i++) await options.nth(i).click();
      await c2.page.keyboard.press("Escape");

      await dlg.getByRole("button", { name: /create view/i }).click();
      await expect(c2.page.getByText(/view created successfully/i))
        .toBeVisible({ timeout: T.action });

      // Share the benchmark back to its contributors (A + B) via the dedicated button.
      const viewRow = c2.page.locator("li").filter({ hasText: BENCH_VIEW }).first();
      await viewRow.getByRole("button", { name: "Share view" }).click();
      const shareDlg = c2.page.getByRole("dialog");
      const addAll = shareDlg.getByRole("button", { name: /add all .* contributors/i });
      await expect(addAll).toBeVisible({ timeout: T.action });
      await addAll.click();
      const confirm = shareDlg.getByRole("button", { name: /confirm share/i });
      await expect(async () => {
        await shareDlg.getByRole("button", { name: /review & share/i }).click();
        await expect(confirm).toBeVisible({ timeout: T.quick });
      }).toPass({ timeout: T.poll });
      await confirm.click();
      await expect(shareDlg.getByText(/shared successfully/i))
        .toBeVisible({ timeout: T.action });
      await shareDlg.getByRole("button", { name: /close/i }).click();
    } finally {
      await c2.ctx.close();
    }

    // ── A (fresh login drains its inbox) sees the benchmark on its Energy view ──
    const a2 = await freshPage(browser, A);
    try {
      // First confirm A actually RECEIVED the benchmark (Share tab) — separates a
      // receipt failure from an energy-render failure.
      await a2.page.getByRole("tab", { name: "Share" }).click();
      await expect(receivedViews(a2.page).getByText(BENCH_VIEW))
        .toBeVisible({ timeout: T.action });

      await a2.page.getByRole("tab", { name: "Manage" }).click();
      const row = a2.page.locator("li", { hasText: STREET }).first();
      await expect(row).toBeVisible({ timeout: T.action });
      const id = (await row.textContent())?.match(/Building (\S+)/)?.[1];
      expect(id, "the shared building's id on Manage").toBeTruthy();

      await a2.page.goto(`/#/energy/${id}`);
      try {
        // The Benchmark column header is always present; the provenance caption
        // appears only once a benchmark has actually been received.
        await expect(
          a2.page.getByRole("columnheader", { name: /benchmark kwh/i }).first(),
        ).toBeVisible({ timeout: T.action });
        await expect(a2.page.getByText(/benchmark provided by/i))
          .toBeVisible({ timeout: T.action });
      } catch (timeout) {
        a2.guard.assertNoAppErrors();
        throw timeout;
      }
    } finally {
      await a2.ctx.close();
    }
  });
});

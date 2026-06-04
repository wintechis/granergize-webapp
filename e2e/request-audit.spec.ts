import { expect, test } from "@playwright/test";
import { account, hasAccount, login } from "./helpers/login.ts";

/**
 * Diagnostic (not an assertion test): capture EVERY network request the app
 * makes from login through a click-through of all tabs, then print which
 * resources are fetched more than once — with per-hit timing so we can tell a
 * StrictMode/double-mount burst (hits clustered in the same few ms) from
 * per-tab-switch refetches (hits spread across the interactions). Run with:
 *   source .env.e2e.local && deno task e2e request-audit
 */

const A = account("A");

interface Hit {
  t: number; // ms since capture start
  method: string;
  url: string; // full URL (with query)
  status?: number;
  fromCache?: boolean;
}

test.describe("request audit", () => {
  test.skip(!hasAccount(A), "needs E2E_USERNAME_A / E2E_PASSWORD_A");

  test("count repeated requests across load + tab switches", async ({ page }) => {
    test.setTimeout(240_000);
    const hits: Hit[] = [];
    const t0 = Date.now();
    const marks: Array<{ t: number; label: string }> = [];
    const mark = (label: string) => marks.push({ t: Date.now() - t0, label });

    page.on("request", (req) => {
      hits.push({
        t: Date.now() - t0,
        method: req.method(),
        url: req.url(),
      });
    });
    page.on("response", (res) => {
      // Attach status to the most recent matching hit without a status yet.
      const url = res.url();
      for (let i = hits.length - 1; i >= 0; i--) {
        if (hits[i].url === url && hits[i].status === undefined) {
          hits[i].status = res.status();
          hits[i].fromCache = res.fromServiceWorker();
          break;
        }
      }
    });

    mark("login start");
    await login(page, A);
    mark("login done (tabs visible)");

    // Let the default (Explore/map) tab settle: queries + tiles drain.
    await page.waitForLoadState("networkidle").catch(() => {});
    mark("view settled");

    // Click through every tab; settle after each.
    for (const name of ["Manage", "Share", "Connect", "Explore"]) {
      const tab = page.getByRole("tab", { name });
      if (await tab.count()) {
        await tab.first().click();
        await page.waitForLoadState("networkidle").catch(() => {});
        mark(`tab: ${name}`);
      }
    }

    // ---- Report -------------------------------------------------------------
    const strip = (u: string) => u.split("#")[0].split("?")[0];
    // Vite dev-server module loads (localhost) are noise — they double only
    // because the OAuth redirect reloads the page. Focus on real traffic.
    const isApp = (u: string) => !u.startsWith("http://localhost");
    const appHits = hits.filter((h) => isApp(h.url));
    const byResource = new Map<string, Hit[]>();
    for (const h of appHits) {
      const key = `${h.method} ${strip(h.url)}`;
      (byResource.get(key) ?? byResource.set(key, []).get(key)!).push(h);
    }

    const repeated = [...byResource.entries()]
      .filter(([, hs]) => hs.length > 1)
      .sort((a, b) => b[1].length - a[1].length);

    const lines: string[] = [];
    lines.push("");
    lines.push("================ REQUEST AUDIT (real traffic, localhost excluded) ================");
    lines.push(`total requests: ${hits.length} (app/external: ${appHits.length})`);
    lines.push(`distinct resources (method+path, query stripped): ${byResource.size}`);
    lines.push(`resources fetched more than once: ${repeated.length}`);
    lines.push("");
    lines.push("timeline marks (ms):");
    for (const m of marks) lines.push(`  ${String(m.t).padStart(7)}  ${m.label}`);
    lines.push("");
    lines.push("REPEATED RESOURCES (most-repeated first):");
    for (const [key, hs] of repeated) {
      const statuses = hs.map((h) => h.status ?? "—").join(",");
      const times = hs.map((h) => h.t).join(",");
      lines.push(`  ${String(hs.length).padStart(3)}x  ${key}`);
      lines.push(`        status=[${statuses}]  t(ms)=[${times}]`);
    }
    lines.push("");
    lines.push("ALL app/external requests in order:");
    for (const h of appHits) {
      lines.push(`  ${String(h.t).padStart(7)}  ${h.method} ${h.url}  -> ${h.status ?? "—"}`);
    }
    lines.push("==============================================");
    console.log(lines.join("\n"));

    // Always pass — this is a diagnostic. Just sanity-check we captured traffic.
    expect(hits.length).toBeGreaterThan(0);
  });
});

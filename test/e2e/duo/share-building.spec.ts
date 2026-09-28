import { expect, test } from "@playwright/test";
import { t, tPattern } from "../helpers/i18n.ts";
import { account, webIdOf } from "../helpers/login.ts";
import { reloadUntil } from "../helpers/reloadUntil.ts";
import { resolveAccounts } from "../../config/resolve.ts";
import { freshPage, freshPagesParallel } from "../helpers/twoPod.ts";
import {
  addBuilding,
  addEnergyYear,
  buildingIdOf,
  buildingRoute,
  deleteBuildingRow,
  openBuildingsList,
  openBuildingsMap,
  shareByWebId,
} from "../helpers/manage.ts";
import { assertCleanStart, verifyAndResetBoth } from "../helpers/cleanSlate.ts";
import { T } from "../helpers/timeouts.ts";

/**
 * End-to-end building sharing across TWO throwaway Solid Pods. Sharing has exactly
 * ONE target: a recipient WebID. (A data room used to be an alternative target —
 * "share with everyone holding role X" — but a room is a WebID DIRECTORY now: you
 * read someone's WebID there and share with the person, so nothing about rooms is
 * on this path any more.)
 *
 * Each test has A add a building + share it, then B logs in fresh (so `drainInbox`
 * archives the grant into B's `shared-in/`), reloading until the building appears
 * under "Buildings shared with you". Beyond that first hop the tests split by what
 * else they prove: the producer's "Shared with:" list + the recipient hide/show
 * toggle, the single-year energy grant, and the delete-revoke.
 *
 * Previously split into 4 single-account parts to stay under solidcommunity.net's
 * Cloudflare burst limit; on the reliable Pods (solidweb.org) it runs as one test
 * driving two browser contexts, and cleans up after itself (A deletes its building
 * + room in `finally`). Needs E2E_{USERNAME,PASSWORD}_A and _B; skipped without.
 *   deno task e2e:remote       (runs the solo + sharing projects against real Pods)
 */

const A = account("A");
const B = account("B");
const STREET = "Teilenstraße 7";

// Cross-Pod sharing needs an INTEROPERATING provider pair. NSS↔CSS-v5 (the current
// A/B) don't interoperate, so this SKIPs with a reason; the logic is covered "in
// principle" by the Tier-2 headless `share-building` task (deno task headless:local).
const pair = resolveAccounts({ count: 2, interoperatingPair: true });

test.describe("sharing across two pods", () => {
  test.skip(!pair.ok, pair.ok ? "" : pair.reason);

  const STREET_W = "WebID Direkt Weg 5"; // distinct from the by-role building

  test("A shares a building by WebID; B sees it under Buildings shared with you", async ({ browser }) => {
    test.setTimeout(T.testSharing);
    // The SIMPLE DUO: A already holds B's WebID, so it shares directly — no room,
    // no role resolution. Keep B's first session open THROUGH the share so B's
    // inbox is provisioned (ensureOwnInbox runs async post-login) and A can POST
    // the grant; B then re-logs in fresh to drain it. Mirrors share-files test 1.
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
    await assertCleanStart(a.page, "share-building:A");
    await assertCleanStart(b1.page, "share-building:B");
    a.page.on("dialog", (d) => d.accept()); // cleanup confirms (delete building)
    try {
      const bWebId = await webIdOf(b1.page);
      await addBuilding(a.page, STREET_W);
      await shareByWebId(a.page, STREET_W, bWebId);
      await b1.ctx.close(); // inbox provisioned; B re-logs in fresh below to drain it

      const b2 = await freshPage(browser, B);
      try {
        const received = b2.page.getByRole("list", {
          name: t("sharedBuildingsHeading"),
        });
        try {
          // No blind write→read cooldown: poll B's view, reloading to re-drain the
          // inbox each attempt, until A's grant propagates and folds in.
          await reloadUntil(b2.page, async () => {
            await b2.page.getByRole("tab", { name: t("navSharing") }).click();
            await expect(received.getByText(tPattern("shareBuildingN")))
              .toBeVisible({ timeout: T.quick });
          });
        } catch (timeout) {
          b2.guard.assertNoAppErrors();
          throw timeout;
        }

        // Click-through: the shared row's title is now a link to the building's
        // read-only detail page (the redesign closed this navigation gap). The
        // link resolves the display stem to the building's resolvable id (the
        // absolute subject IRI), so following it lands on /building/<id> and the
        // header shows the "Shared with you" ownership chip.
        await received.getByRole("link", { name: tPattern("shareBuildingN") }).first().click();
        await expect(b2.page).toHaveURL(/\/building\?/);
        // Exact match: the detail page's ownership chip is exactly "Shared with you"
        // (tierShared), whereas SharingFinder's "Buildings/Aggregations shared
        // with you" headings would make a substring locator strict-mode-ambiguous.
        await expect(
          b2.page.getByText(t("tierShared"), { exact: true }),
        ).toBeVisible({ timeout: T.action });
      } finally {
        await b2.ctx.close();
      }
    } finally {
      await b1.ctx.close().catch(() => {}); // no-op if already closed above
      // Self-cleaning: A deletes its building (no room to drop — direct share).
      try {
        if (!a.page.isClosed()) {
          await a.page.goto("/");
          await openBuildingsList(a.page);
          const row = a.page.locator("li[data-building-id]", { hasText: STREET_W })
            .first();
          if (await row.count()) {
            const id = await buildingIdOf(row);
            if (id) await deleteBuildingRow(a.page, id);
          }
        }
      } catch {
        // best-effort cleanup; never fail the run
      }
      const bEnd = await freshPage(browser, B);
      try {
        await verifyAndResetBoth(a.page, bEnd.page, "share-building");
      } finally {
        await bEnd.ctx.close();
        await a.ctx.close();
      }
    }
  });

  test("the producer sees the share; B can hide and re-show it", async ({ browser }) => {
    test.setTimeout(T.testSharing);
    // A and B's first logins are independent, so run both ~50 s OIDC flows
    // concurrently — one login's wall-clock instead of two.
    // Clean START is free: a Tier-4 run gets a fresh per-run collection, Tier 3 a
    // freshly-restarted CSS. The spec wipes BOTH pods at the END instead.
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
    await assertCleanStart(a.page, "share-building:A");
    await assertCleanStart(b1.page, "share-building:B");
    a.page.on("dialog", (d) => d.accept()); // cleanup confirms (delete building)
    try {
      const bWebId = await webIdOf(b1.page);
      await b1.ctx.close();

      await addBuilding(a.page, STREET);
      await shareByWebId(a.page, STREET, bWebId);

      // ── Producer side: the building page's SharingSection now surfaces the
      // outgoing-share STATE — the "Shared with:" list (the materialized fold of
      // the shared-out/ event log, via useSharedBuildings) with a per-recipient
      // "Revoke access" control + the <AgentLabel> recipient. The redesign moved
      // this off the Manage row onto /building/:id; it shows in default (non-dev)
      // mode, unlike the raw shared-out/ log link. Re-routing to the page forces a
      // fresh fold (sharing doesn't invalidate the query).
      await openBuildingsList(a.page);
      const aRow = a.page.locator("li[data-building-id]", { hasText: STREET })
        .first();
      await expect(aRow).toBeVisible({ timeout: T.action });
      const aId = await buildingIdOf(aRow);
      await a.page.goto(buildingRoute("building", aId));
      // The SharingSection's heading, the "Shared with:" list, and each recipient's
      // "Revoke access" control are unique on the building page, so assert on the
      // page directly (the "Shared with" list is a sibling of the heading+Share
      // Stack, not nested under it). Sharing doesn't invalidate the shared-out
      // fold, so the in-memory query can hold the pre-share (empty) state; a reload
      // re-mounts the page and cold-refetches it — poll the reload until the
      // recipient + its Revoke control appear.
      await reloadUntil(a.page, async () => {
        await expect(a.page.getByText(t("sharedWithLabel")))
          .toBeVisible({ timeout: T.quick });
        await expect(
          a.page.getByRole("button", { name: t("revokeAccess") }).first(),
        ).toBeVisible({ timeout: T.quick });
      });
      // Back to the shell for the read-side / cleanup tab nav.
      await a.page.goto("/");

      // ── Read part: B logs in fresh → drainInbox archives the grant → verify ──
      const b2 = await freshPage(browser, B);
      try {
        const received = b2.page.getByRole("list", {
          name: t("sharedBuildingsHeading"),
        });
        try {
          // No blind write→read cooldown: poll B's view, reloading to re-drain the
          // inbox each attempt, until A's grant propagates and folds in.
          await reloadUntil(b2.page, async () => {
            await b2.page.getByRole("tab", { name: t("navSharing") }).click();
            await expect(received.getByText(tPattern("shareBuildingN")))
              .toBeVisible({ timeout: T.quick });
          });
        } catch (timeout) {
          b2.guard.assertNoAppErrors();
          throw timeout;
        }

        // heike-1 / handbuch: B can hide a building shared with them from their
        // OWN dashboard (map + lists) via the eye toggle, without touching the
        // owner's share. The Share-tab row carries a "Shown/Hidden" Switch
        // (gran:hiddenBuilding in prefs.ttl, re-read by getSharedWithMe). B owns
        // nothing, so the shared building is the only Buildings/Map marker — a
        // clean signal that hiding removes it from the map and showing brings it
        // back.
        const sharedRow = received.locator("li")
          .filter({ has: b2.page.getByText(tPattern("shareBuildingN")) }).first();
        const visToggle = sharedRow.getByRole("switch"); // the Shown/Hidden Switch (MUI v9 Switch → role="switch")
        await expect(sharedRow.getByText(t("shareShown"))).toBeVisible({
          timeout: T.action,
        });
        const markers = b2.page.locator(".leaflet-marker-icon");

        // Hide → row reads "Hidden" and B's Buildings/Map drops to no markers.
        await visToggle.click();
        await expect(sharedRow.getByText(t("shareHidden"))).toBeVisible({
          timeout: T.action,
        });
        await openBuildingsMap(b2.page);
        await expect(async () => {
          expect(await markers.count()).toBe(0);
        }).toPass({ timeout: T.poll });

        // Show → row reads "Shown" again and the marker returns.
        await b2.page.getByRole("tab", { name: t("navSharing") }).click();
        await expect(sharedRow.getByText(t("shareHidden"))).toBeVisible({
          timeout: T.action,
        });
        await visToggle.click();
        await expect(sharedRow.getByText(t("shareShown"))).toBeVisible({
          timeout: T.action,
        });
        await openBuildingsMap(b2.page);
        await expect(markers.first()).toBeVisible({ timeout: T.action });
      } finally {
        await b2.ctx.close();
      }
    } finally {
      // Self-cleaning: A deletes its building + the room it hosted (best-effort).
      try {
        if (!a.page.isClosed()) {
          await a.page.goto("/");
          await openBuildingsList(a.page);
          const row = a.page.locator("li[data-building-id]", { hasText: STREET })
            .first();
          if (await row.count()) {
            const id = await buildingIdOf(row);
            if (id) await deleteBuildingRow(a.page, id);
          }
        }
      } catch {
        // best-effort cleanup; never fail the run
      }
      // Leave both Pods empty — the in-flow cleanup above is verified (residue
      // logged), then the per-run collection is removed entirely on each Pod.
      const bEnd = await freshPage(browser, B);
      try {
        await verifyAndResetBoth(a.page, bEnd.page, "share-building");
      } finally {
        await bEnd.ctx.close();
        await a.ctx.close();
      }
    }
  });

  // PROBLEMS.md #17: share a single YEAR of energy, not all of it. A's building
  // carries two annual years (2098, 2099); A grants only 2099 via the per-year
  // picker. The crux is the recipient side: B can read 2099 but is denied 2098 —
  // the building file lists both `cons:hasEnergyDataset` links (B reads the file),
  // but only 2099's dataset .acl grants B, so 2098 403s and AnnualEnergy skips
  // it. The map's Energy tab renders AnnualEnergy's per-year table, so both the
  // present (2099) and the withheld (2098) year are observable in one view.
  const STREET_Y = "Jahrgasse 9"; // distinct from the all-energy test's building
  const SHARED_YEAR = "2099";
  const WITHHELD_YEAR = "2098";

  test("A shares one year of energy; B sees that year but not the withheld one", async ({ browser }) => {
    test.setTimeout(T.longOp);
    // Clean START is free: a Tier-4 run gets a fresh per-run collection, Tier 3 a
    // freshly-restarted CSS. The spec wipes BOTH pods at the END instead.
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
    await assertCleanStart(a.page, "share-building:A");
    await assertCleanStart(b1.page, "share-building:B");
    a.page.on("dialog", (d) => d.accept()); // cleanup confirms (delete building/room)
    try {
      const bWebId = await webIdOf(b1.page);
      await b1.ctx.close();

      // ── A adds a building with two annual years, shares only the later one ──
      await addBuilding(a.page, STREET_Y);
      await addEnergyYear(a.page, STREET_Y, WITHHELD_YEAR, "11111");
      await addEnergyYear(a.page, STREET_Y, SHARED_YEAR, "22222");
      await shareByWebId(a.page, STREET_Y, bWebId, { years: [Number(SHARED_YEAR)] });

      // ── Read part: B logs in fresh → drainInbox archives the grant → verify ──
      const b2 = await freshPage(browser, B);
      try {
        // B owns no buildings (none seeded), so the shared one is the only marker.
        // No blind write→read cooldown: poll, reloading to re-drain the inbox each
        // attempt, until the shared marker propagates and renders.
        const markers = b2.page.locator(".leaflet-marker-icon");
        await reloadUntil(b2.page, async () => {
          await openBuildingsMap(b2.page);
          await expect(markers.first()).toBeVisible({ timeout: T.quick });
        });

        // The map is a pure finder now: a marker click NAVIGATES to the shared
        // building's page (`/building?uri=<id>` — a shared id is absolute, so it
        // rides in `?uri=`). B owns no buildings, so the shared one is the only
        // marker — click it and capture the id from the URL query, then open its
        // observation page (the AnnualEnergy per-year table lives there).
        await markers.first().click({ force: true });
        await b2.page.waitForURL(/\/building\?/, { timeout: T.action });
        const sharedId =
          new URL(b2.page.url()).searchParams.get("uri") ??
            new URL(b2.page.url()).searchParams.get("ref") ?? "";
        expect(sharedId, "the shared building's id").toBeTruthy();
        await b2.page.goto(buildingRoute("observation", sharedId));

        try {
          // The granted year renders as an AnnualEnergy row with its electricity
          // figure (de-DE "22.222", 0 decimals)...
          const grantedRow = b2.page.getByRole("row", {
            name: new RegExp(SHARED_YEAR),
          });
          await expect(grantedRow).toBeVisible({ timeout: T.action });
          await expect(grantedRow.getByText("22.222")).toBeVisible();
          // ...the withheld year's dataset 403s for B, so it never appears.
          await expect(
            b2.page.getByRole("cell", { name: WITHHELD_YEAR, exact: true }),
          ).toHaveCount(0);
        } catch (timeout) {
          b2.guard.assertNoAppErrors();
          throw timeout;
        }
      } finally {
        await b2.ctx.close();
      }
    } finally {
      // Self-cleaning: A deletes its building + the room it hosted (best-effort).
      try {
        if (!a.page.isClosed()) {
          await a.page.goto("/");
          await openBuildingsList(a.page);
          const row = a.page.locator("li[data-building-id]", {
            hasText: STREET_Y,
          }).first();
          if (await row.count()) {
            const id = await buildingIdOf(row);
            if (id) await deleteBuildingRow(a.page, id);
          }
        }
      } catch {
        // best-effort cleanup; never fail the run
      }
      // Leave both Pods empty — the in-flow cleanup above is verified (residue
      // logged), then the per-run collection is removed entirely on each Pod.
      const bEnd = await freshPage(browser, B);
      try {
        await verifyAndResetBoth(a.page, bEnd.page, "share-building");
      } finally {
        await bEnd.ctx.close();
        await a.ctx.close();
      }
    }
  });

  // When A DELETES a shared building, B must lose it cleanly: deletion revokes the
  // recipient first (logs the revocation, withdraws the ACL, notifies the inbox),
  // so after B drains the inbox the building folds out of "Buildings shared with
  // you" — it doesn't linger until a later 404-prune. (Tier-1 + Tier-2 cover the
  // data layer; this is the in-practice browser check.)
  const STREET_D = "Entfernweg 3";

  test("A deletes a shared building; B no longer sees it under Buildings shared with you", async ({ browser }) => {
    test.setTimeout(T.testSharing);
    // Clean START is free: a Tier-4 run gets a fresh per-run collection, Tier 3 a
    // freshly-restarted CSS. The spec wipes BOTH pods at the END instead.
    const [a, b1] = await freshPagesParallel(browser, [A, B]);
    await assertCleanStart(a.page, "share-building:A");
    await assertCleanStart(b1.page, "share-building:B");
    a.page.on("dialog", (d) => d.accept()); // delete-building confirm + cleanup
    try {
      const bWebId = await webIdOf(b1.page);
      await b1.ctx.close();
      await addBuilding(a.page, STREET_D);
      await shareByWebId(a.page, STREET_D, bWebId);

      // ── B logs in fresh once → drainInbox archives the grant → B sees it ──
      // The SAME B context is reused for the after-delete re-check: a reload
      // re-runs drainInbox (Login.tsx restores the session → "login" → handleLogin
      // → drainInbox), so B drains the revocation without a second ~OIDC login.
      const b = await freshPage(browser, B);
      try {
        await b.page.getByRole("tab", { name: t("navSharing") }).click();
        const received = () =>
          b.page.getByRole("list", { name: t("sharedBuildingsHeading") });
        try {
          await expect(received().getByText(tPattern("shareBuildingN")))
            .toBeVisible({ timeout: T.action });
        } catch (timeout) {
          b.guard.assertNoAppErrors();
          throw timeout;
        }

        // ── A deletes the shared building (revokes B + posts the inbox notice) ──
        await a.page.goto("/");
        await openBuildingsList(a.page);
        const row = a.page.locator("li[data-building-id]", { hasText: STREET_D })
          .first();
        await expect(row).toBeVisible({ timeout: T.action });
        const delId = await buildingIdOf(row);
        if (!delId) throw new Error("share-building delete: no id for " + STREET_D);
        await deleteBuildingRow(a.page, delId);
        // ── B reloads → drainInbox drains the revocation → it folds out. No blind
        //    settle wait: reload inside the poll so each attempt re-drains. ──
        try {
          // B owned nothing else, so the received list must have no building rows.
          await reloadUntil(b.page, async () => {
            await b.page.getByRole("tab", { name: t("navSharing") }).click();
            expect(await received().getByText(tPattern("shareBuildingN")).count()).toBe(0);
          });
        } catch (timeout) {
          b.guard.assertNoAppErrors();
          throw timeout;
        }
      } finally {
        await b.ctx.close();
      }
    } finally {
      // Building already deleted by the test.
      // Leave both Pods empty — the in-flow cleanup above is verified (residue
      // logged), then the per-run collection is removed entirely on each Pod.
      const bEnd = await freshPage(browser, B);
      try {
        await verifyAndResetBoth(a.page, bEnd.page, "share-building");
      } finally {
        await bEnd.ctx.close();
        await a.ctx.close();
      }
    }
  });
});

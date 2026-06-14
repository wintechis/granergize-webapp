/// <reference lib="dom" />
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  account,
  hasAccount,
  login,
  LOGIN_HEADING,
  webIdOf,
} from "../helpers/login.ts";
import { freshPage } from "../helpers/twoPod.ts";
import { buildingRoute, exploreRoute } from "../helpers/manage.ts";
import { setDevMode } from "../helpers/accountMenu.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";

/**
 * Captures the Praxishandbuch figures (docs/figures/*.png) by driving the
 * logged-in app. The usual run is the LOCAL tier (`deno task handbuch`,
 * E2E_LOCAL=1): the control server seeds the three actors with human identities
 * (foaf:name + avatar — Alice/Bob/Charlie), company identities (an org node with
 * name + logo — Ahlmann Logistik / Bauer Grundbesitz / Conrad Kennwert) and the BSP
 * benchmark round-trip, so the figures show distinguishable people and firms
 * and a real Benchmark column. The same
 * spec also runs remotely (canonical solidcommunity.net URIs; no seeding —
 * profiles there are whatever the throwaway accounts carry):
 *
 *   E2E_USERNAME_A=...  E2E_PASSWORD_A=...  [E2E_PROVIDER_A=solidcommunity] \
 *   E2E_USERNAME_B=...  E2E_PASSWORD_B=...  [E2E_PROVIDER_B=...] \
 *     deno task e2e:remote:spec test/e2e/support/screenshots.spec.ts
 *
 * Most figures need only account A. The last figure (shared-with-you.png — the
 * recipient's "Buildings shared with you" list) needs account **B** too: A shares
 * a building with B by WebID, then B logs in and we capture B's Share tab. When B
 * is unconfigured that one shot is skipped (the committed figure is kept); the
 * whole run is skipped when A is absent (so CI / a no-cred run needs no creds).
 * Run headed to debug:
 *   deno task e2e:remote:spec test/e2e/support/screenshots.spec.ts -- --headed
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;
/** POST a control-server seed endpoint (local tier only); fails the run loudly. */
async function controlSeed(path: string): Promise<Response> {
  const res = await fetch(
    `http://localhost:${LOCAL_CSS_CONTROL_PORT}${path}`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${await res.text()}`);
  return res;
}

const ACC = account("A");
// A WebID to seed the Contacts address book before its screenshot. Prefer a
// configured account's WebID (resolves to a real name/avatar); fall back to the
// handbuch's example WebID so the figure still shows a populated list. The local
// tier replaces this with B's REAL WebID from /seed-profiles (never constructed).
const CONTACT_WEBID = account("B").webId || ACC.webId ||
  "https://maxmustermann.solidcommunity.net/profile/card#me";
/** The benchmark view name seeded by /seed-benchmark (shows on received rows). */
const BENCHMARK_NAME = "Energie-Benchmark";
const OUT = "docs/figures";
// Cooldown after every screenshot. Its only purpose is to let a Cloudflare-fronted
// provider's rate limit relax between request bursts, so it's only long when A's
// provider is throttled (e.g. solidcommunity.net); on a plain CSS (e.g. redpencil)
// a short settle is enough and keeps the whole run a few minutes.
const COOLDOWN_MS = ACC.provider.throttled ? 16_000 : 2_000;

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}`, animations: "disabled" });
  await page.waitForTimeout(COOLDOWN_MS);
}

/** Screenshot a single element (a focused figure), then the same cooldown. */
async function shotOf(locator: Locator, name: string) {
  await locator.screenshot({ path: `${OUT}/${name}`, animations: "disabled" });
  await locator.page().waitForTimeout(COOLDOWN_MS);
}

/**
 * Wait until the Leaflet map has its tiles drawn: every `.leaflet-tile` carries
 * `leaflet-tile-loaded` (Leaflet sets it when the tile image has loaded).
 * `networkidle` is not enough for the map figures — it can fall in a lull
 * between the data burst and the tile requests, capturing a grey map.
 * Time-boxed so a slow tile server degrades the figure, not the run.
 */
async function waitForMapTiles(page: Page) {
  await page.waitForFunction(() => {
    const tiles = document.querySelectorAll(".leaflet-tile");
    return tiles.length > 0 &&
      Array.from(tiles).every((t) => t.classList.contains("leaflet-tile-loaded"));
  }, undefined, { timeout: 60_000 }).catch(() => {});
}

/**
 * Best-effort dismiss of any open snackbar toast. TIME-BOXED on purpose: this
 * project's default action timeout is 0 (wait forever), so an unbounded click on
 * a non-existent close button would hang the whole run. Scoped to a "Close"
 * button (the snackbar's), never the role=alert banners (the fresh-Pod onboarding
 * Alert has no close button, so an alert-scoped close-click would never resolve).
 */
async function dismissToasts(page: Page) {
  await page.getByRole("button", { name: /^close$/i }).first()
    .click({ timeout: 4_000 }).catch(() => {});
}

test.describe("handbuch screenshots", () => {
  test.skip(
    !hasAccount(ACC),
    "Set E2E_USERNAME_A and E2E_PASSWORD_A (a throwaway solidcommunity.net Pod) to capture screenshots.",
  );

  test("capture", async ({ page, browser }) => {
    // Bounded by the cooldown cost: ~14 shots × COOLDOWN_MS plus two logins, the
    // demo-buildings seed (4 geocodes + a 21-day series) and the cross-pod share.
    // On a throttled provider that's many minutes; on a plain CSS it runs the
    // full walkthrough to the last shot in ~10 min, so the cap carries headroom
    // over that. Every best-effort interaction is itself time-boxed (the default
    // action timeout is 0 = wait forever), so a stuck locator fails in seconds
    // rather than eating this cap.
    test.setTimeout(ACC.provider.throttled ? 1_800_000 : 900_000);
    await page.setViewportSize({ width: 1200, height: 900 });

    // --- Login screen (captured BEFORE logging in) (anmelden.png — handbuch figure).
    //     The Login component shows a ~2 s "Loading…" while it tries to restore a
    //     previous session; on a fresh context that resolves to the IdP picker. ---
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: LOGIN_HEADING }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: /solidcommunity\.net/i }).first()
      .waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, "anmelden.png");

    await login(page, ACC);

    // Local tier: give the three seeded actors their human identity (foaf:name +
    // public avatar — Alice Ahlmann, Bob Bauer, Charlie Conrad), so every figure
    // shows resolvable names and faces instead of WebID-fragment labels ("me").
    // Runs AFTER login on purpose: the first login restarts the CSS
    // (resetLocalPodsOnce), which would wipe an earlier seed. The reload makes
    // the already-running session re-read the now-named profiles.
    let contactWebId = CONTACT_WEBID;
    if (E2E_LOCAL) {
      const webIds = await (await controlSeed("/seed-profiles")).json() as
        Record<string, string>;
      contactWebId = webIds.B ?? contactWebId;
      await page.reload();
      await expect(page.getByRole("tab", { name: "Connect" }))
        .toBeVisible({ timeout: 60_000 });
    }

    // Handbuch figures are ALWAYS captured with Developer mode OFF — no raw-RDF /
    // debug affordances (the dev-only header building-URI line, inline request
    // URIs, the request log) should appear in the screenshots. uncheck() is a
    // no-op when it's already off (the default), so this just pins the invariant.
    await setDevMode(page, false);

    // --- Post-login first start (erster-start.png — handbuch figure): after
    //     login the app lands on the Explore map, and on a fresh Pod the
    //     onboarding banner offers the demo buildings ("No buildings yet — add a
    //     couple of example buildings to explore?"). Captured BEFORE that banner's
    //     "Add examples" is accepted further down, so the figure shows the empty
    //     starting state a first-time user actually sees — the app opens on
    //     adding buildings. On the local tier the header already carries the
    //     seeded org logo + avatar (from /seed-profiles). Best-effort: on an
    //     idempotent re-run against a non-fresh Pod the banner is absent and the
    //     map already has markers, so the committed figure is kept. ---
    await page.getByRole("tab", { name: "Explore" }).click();
    await page.getByRole("button", { name: "Add examples" })
      .waitFor({ timeout: 15_000 }).catch(() => {});
    await waitForMapTiles(page);
    await page.waitForTimeout(800);
    await shot(page, "erster-start.png");

    // --- Account A's organisation (name + logo), so a building marker's hover
    //     card identifies the producer (org name + logo; the marker itself is a
    //     plain owned/shared pin). The demo buildings seeded below attribute
    //     their provenance to A, so their hover cards resolve this org. The
    //     LOCAL tier gets its org from /seed-profiles (Ahlmann Logistik, with a
    //     world-readable logo) — setting one here would overwrite it — so only
    //     the remote tier sets an org through the UI. ---
    if (!E2E_LOCAL) {
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByRole("menuitem", { name: /organisation/i }).click();
      const orgDialog = page.getByRole("dialog");
      await expect(orgDialog).toBeVisible({ timeout: 30_000 });
      await orgDialog.getByLabel("Company name")
        .fill("Friedrich-Alexander-Universität Erlangen-Nürnberg");
      // The org resolves in a building marker's hover card via its PROV
      // attribution to the producing agent (A), recorded on every building A adds.
      await orgDialog.locator('input[type="file"]')
        .setInputFiles("test/e2e/fixtures/fau-logo.png");
      await expect(orgDialog.getByAltText("Organisation logo"))
        .toBeVisible({ timeout: 15_000 });
      await orgDialog.getByRole("button", { name: /^save$/i }).click();
      await expect(page.getByText(/organisation saved/i))
        .toBeVisible({ timeout: 60_000 });
      // Dismiss the toast so it doesn't linger into the next (room) screenshot.
      await dismissToasts(page);
      await page.waitForTimeout(1000);
    }

    // --- Meet: be in a room with a role (seeds an empty Pod so the rest of the
    //     app has something to show) ---
    await page.getByRole("tab", { name: "Connect" }).click();
    const leave = page.getByRole("button", { name: /leave data room/i });
    if (!(await leave.count())) {
      await page.getByRole("button", { name: /host a data room/i }).click();
      await expect(leave).toBeVisible({ timeout: 30_000 });
    }
    // Assign the User role (MUI multi-select: open, tick, close, save).
    const roleSelect = page.getByRole("combobox", { name: "My role(s)" });
    await roleSelect.click();
    await page.getByRole("option", { name: "User" }).click();
    await page.keyboard.press("Escape");
    await expect(roleSelect).toContainText("User", { timeout: 5_000 }).catch(
      () => {},
    );
    await page.getByRole("button", { name: /save roles/i }).click();
    await expect(page.getByText(/roles updated/i)).toBeVisible({ timeout: 15_000 })
      .catch(() => {});
    await page.waitForTimeout(1000);
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await shot(page, "room.png");

    // Dismiss the "Roles updated" toast, then ACCEPT the fresh-Pod onboarding
    // banner's "Add examples": every figure is captured over the SAME four demo
    // buildings a reader gets from that banner (handbuch examples = app
    // examples). The seed geocodes four Nürnberg addresses and writes the
    // energy datasets (incl. a 21-day 15-min series), so the toast wait is
    // generous. Time-boxed click: on an idempotent re-run against a non-fresh
    // Pod the banner doesn't show and the buildings already exist.
    await dismissToasts(page);
    const addExamples = page.getByRole("button", { name: "Add examples" });
    if (await addExamples.count()) {
      await addExamples.click({ timeout: 8_000 }).catch(() => {});
      await expect(page.getByText("Demo buildings and energy data added").first())
        .toBeVisible({ timeout: 300_000 });
      await dismissToasts(page);
    }

    // Local tier: seed the BSP contribution + computation over the demo
    // buildings — A's and two of B's buildings shared (energy included) to C
    // (Charlie), who computes the "Compare shared buildings" benchmark. The
    // share-BACK then happens in C's real UI below, so the figure shows the
    // live "Add all contributors" moment and the later figures its results
    // (A's filled Benchmark column naming Charlie, B's received view).
    if (E2E_LOCAL) {
      await controlSeed(`/seed-benchmark?name=${BENCHMARK_NAME}`);

      // --- The BSP's perspective (benchmark-share-back.png): Charlie opens the
      //     benchmark view's share dialog and adds both contributors with one
      //     click — the Energieverbrauchsbenchmark walkthrough's share-back,
      //     captured mid-flow — then actually
      //     shares so the round-trip completes.
      const c = await freshPage(browser, account("C"));
      try {
        // C owns no buildings: dismiss C's fresh-Pod onboarding banner.
        await c.page.getByRole("button", { name: "No thanks" })
          .click({ timeout: 8_000 }).catch(() => {});
        await c.page.getByRole("tab", { name: "Manage" }).click();
        const viewRow = c.page.locator("li").filter({ hasText: BENCHMARK_NAME })
          .first();
        await expect(viewRow).toBeVisible({ timeout: 60_000 });
        await viewRow.getByRole("button", { name: "Share view" }).click();
        const shareDialog = c.page.getByRole("dialog");
        const addAll = shareDialog.getByRole("button", {
          name: /add all \d+ contributors/i,
        });
        await expect(addAll).toBeEnabled({ timeout: 60_000 });
        await addAll.click();
        await c.page.waitForTimeout(500);
        await shot(c.page, "benchmark-share-back.png");
        await shareDialog.getByRole("button", { name: "Review and Share" }).click();
        await shareDialog.getByRole("button", { name: "Confirm Share" })
          .click({ timeout: 10_000 });
        await expect(shareDialog.getByText(/shared successfully/i))
          .toBeVisible({ timeout: 120_000 });
      } finally {
        await c.ctx.close();
      }

      // The seeding + share-back wrote A's pod from OUTSIDE the running session
      // (cross-agent writes), and all later figure navigations are same-document
      // hash gotos that never refetch the shared-in fold — so reload ONCE here
      // (the app's reload drain archives the received grant), then return to
      // the Connect tab the next section expects.
      await page.reload();
      const connectTab = page.getByRole("tab", { name: "Connect" });
      await expect(connectTab).toBeVisible({ timeout: 60_000 });
      await connectTab.click();
    }

    // --- Contacts: seed one address-book entry, then capture the Contacts
    //     section at the top of the Connect tab. The list is otherwise empty on
    //     a fresh Pod, so the figure would read "No contacts yet". ---
    // Let the room-creation/role-save network burst settle so the Contacts field
    // is stable before we fill it (an unstable element stalls fill).
    await page.waitForLoadState("networkidle").catch(() => {});
    const webIdField = page.getByRole("textbox", { name: "WebID" });
    await webIdField.waitFor({ state: "visible", timeout: 30_000 });
    await webIdField.fill(contactWebId, { timeout: 15_000 });
    const addContact = page.getByRole("button", { name: "Add contact" });
    await expect(addContact).toBeEnabled({ timeout: 10_000 });
    await addContact.click();
    await expect(page.getByRole("list", { name: "Contacts" }))
      .toBeVisible({ timeout: 30_000 }).catch(() => {});
    await dismissToasts(page);
    await page.waitForTimeout(1000);
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await shot(page, "contacts.png");

    // --- Data: the four demo buildings (seeded via "Add examples" above) give
    //     every later figure its content; the Add Building dialog lives on the
    //     Manage tab ---
    await page.getByRole("tab", { name: "Manage" }).click();
    const dialog = page.getByRole("dialog");
    // Wait for a per-building row action (only present once a building has
    // loaded) so no figure captures a "Loading…" panel.
    const shareAction = page.getByRole("button", { name: "Share building data" })
      .first();
    await shareAction.waitFor({ state: "visible", timeout: 60_000 });

    // Add Building dialog — capture the one generic form, then close (the demo
    // buildings are the data; nothing is added manually).
    await page.getByRole("button", { name: /^add building$/i }).click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot(page, "add-building.png");
    await page.keyboard.press("Escape");

    // Manage tab now lists the building with its per-row actions (edit / share /
    // download / delete) — the subject of the sharing section. Wait for a row's action
    // to be present so the screenshot isn't a "Loading…" panel.
    await expect(shareAction).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await shot(page, "share-building.png");

    // --- Manage row actions: a focused shot of one building row showing the
    //     per-building actions (edit / files / energy year / share / download /
    //     delete) — the subject of "Gebäude bearbeiten, Dateien … und löschen" ---
    const buildingRow = page.locator("li").filter({
      has: page.getByRole("button", { name: "Share building data" }),
    }).first();
    await buildingRow.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(300);
    await shotOf(buildingRow, "manage-actions.png");

    // --- Energy-year dialog: the per-year consumption form plus the "Stored
    //     years" read-back table, opened on the Nordostpark demo — its table is
    //     populated out of the box (actual 2022–2024 AND the planned 2024, so
    //     the figure shows the Soll-Ist pair and the building-name header). ---
    const nordostparkRow = page.locator("li").filter({ hasText: "Nordostpark" })
      .first();
    await expect(nordostparkRow).toBeVisible({ timeout: 30_000 });
    await nordostparkRow
      .getByRole("button", { name: "Add or edit energy year" }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    // The stored-years table loads the datasets — wait for the planned 2024 row.
    await expect(
      page.getByRole("dialog").getByRole("row", { name: /Planned/ }).first(),
    ).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(500);
    await shot(page, "energy-year.png");
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });

    // --- Manage: aggregated views (Create View lives here, with buildings) ---
    await page.getByRole("tab", { name: "Manage" }).click();
    await page.waitForTimeout(500);

    // --- Create View dialog (buildings are now selectable) ---
    await page.getByRole("button", { name: /create view/i }).click();
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await shot(page, "create-view.png");

    // --- Aggregated-view result page (aggregated-view.png): finish creating the
    //     view over the three annual-carrying demo buildings (the two investors
    //     plus Lange Gasse, which carries annual data next to its series;
    //     idempotent: skip if a prior run created it), then open it — the summary
    //     auto-computes its snapshot on first open, so the figure shows the
    //     chart + table without a manual refresh. ---
    const VIEW_NAME = "Portfolio Nürnberg";
    const viewRow = page.locator("li").filter({ hasText: VIEW_NAME }).first();
    if (await viewRow.count()) {
      await page.keyboard.press("Escape"); // view exists from a prior run
    } else {
      await dialog.getByLabel("View Name").fill(VIEW_NAME);
      await dialog.getByLabel("Select Buildings").click();
      for (const street of ["Nordostpark", "Hafenstraße", "Lange Gasse"]) {
        await page.getByRole("option").filter({ hasText: street }).first()
          .click({ timeout: 10_000 }).catch(() => {});
      }
      await page.keyboard.press("Escape"); // close the building multi-select
      await dialog.getByRole("button", { name: /create view/i }).click();
      await expect(page.getByText(/view created successfully/i))
        .toBeVisible({ timeout: 60_000 });
      await dismissToasts(page);
    }
    await expect(viewRow).toBeVisible({ timeout: 30_000 });
    await viewRow.getByRole("button", { name: "View details" }).click();
    // The standalone view route: wait for the auto-computed chart to draw.
    await expect(
      page.locator("svg.recharts-surface .recharts-bar-rectangle").first(),
    ).toBeVisible({ timeout: 120_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    // Park the pointer off the chart — the click that opened the view leaves the
    // mouse over a bar, whose hover tooltip would photobomb the figure.
    await page.mouse.move(0, 0);
    await page.waitForTimeout(800);
    await shot(page, "aggregated-view.png");
    // Back to the app shell (the view page is a standalone route without tabs).
    await page.goto("/#/");
    await expect(page.getByRole("tab", { name: "Explore" }))
      .toBeVisible({ timeout: 30_000 });

    // --- Explore: the Nordostpark demo's Building/Energy/Weather detail pane.
    //     Selected deterministically via the URI-state deep link (the same
    //     selection a marker click produces) — a blind marker click could land
    //     on any of the four demo markers. The fully-populated investor demo
    //     gives the figure a rich detail panel. ---
    await page.getByRole("tab", { name: "Manage" }).click();
    const nordRow = page.locator("li").filter({ hasText: "Nordostpark" }).first();
    await expect(nordRow).toBeVisible({ timeout: 30_000 });
    const buildingId = await nordRow.getAttribute("data-building-id");
    await page.goto(exploreRoute(buildingId));
    await expect(page.getByRole("tab", { name: "Building data" }))
      .toBeVisible({ timeout: 60_000 });
    const markers = page.locator(".leaflet-marker-icon");
    await markers.first().waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await waitForMapTiles(page);
    await page.waitForTimeout(1500); // let markers/logos settle
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await shot(page, "map-tabs.png");

    // --- Energy lens (energy-lens.png): switch the map's colour lens from
    //     Ownership to Energy so the markers are tinted by energy intensity, and
    //     the legend shows the efficiency categories. The annual demo buildings
    //     carry areas + energy years, so their intensities are computable and the
    //     markers are tinted. Phase-2 energy must have landed for the tint, so
    //     allow it to settle before the shot. ---
    const energyLens = page.getByRole("button", { name: "Energy", exact: true });
    if (await energyLens.count()) {
      await energyLens.click({ force: true }).catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await waitForMapTiles(page);
      await page.waitForTimeout(1200);
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await shot(page, "energy-lens.png");
      // Restore the default lens so it can't bleed into a later re-run's shots.
      await page.getByRole("button", { name: "Ownership", exact: true })
        .click({ force: true }).catch(() => {});
    }

    // --- Energy-data tab with the operator average (energy-data-tab.png): the
    //     Nordostpark demo's "Energy data" tab. Two annual-carrying demos
    //     (Nordostpark + Lange Gasse) are self-operated, so the summary table
    //     shows the "Operator average" row — the Betreiber benchmark of the
    //     handbuch's "Daten ansehen" section — plus the planned-2024 (Soll)
    //     column pair. ---
    if (buildingId) {
      await page.goto(exploreRoute(buildingId, "energy"));
      await expect(
        page.getByRole("row").filter({ hasText: "Operator average" }).first(),
      ).toBeVisible({ timeout: 60_000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      await waitForMapTiles(page);
      await page.waitForTimeout(800);
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await shot(page, "energy-data-tab.png");

      // --- The Soll-Ist walkthrough punchline (soll-ist-payoff.png): the
      //     annual overview table alone — the planned (Soll) entry next to the
      //     actual years. Embedded in the handbuch's "Soll-Ist-Vergleich
      //     durchgespielt" walkthrough. ---
      await shotOf(
        page.locator("table").filter({
          has: page.getByText(/\(planned\)/i),
        }).first(),
        "soll-ist-payoff.png",
      );

      // --- Energy detail page (energy-detail.png): the standalone /energy/:id
      //     route — latest year's figures with the Portfolio / Operator /
      //     Benchmark comparison columns side by side. ---
      await page.goto(buildingRoute("energy", buildingId));
      await expect(
        page.getByRole("heading", { name: /Energy Need for / }),
      ).toBeVisible({ timeout: 60_000 });
      await expect(
        page.locator("th", { hasText: "Operator average kWh / a" }).first(),
      ).toBeVisible({ timeout: 60_000 });
      // Local tier: the seeded BSP benchmark must be on the page — the filled
      // Benchmark column plus the provider caption naming Charlie — before the
      // shot (the figure's caption promises all three comparison columns).
      if (E2E_LOCAL) {
        await expect(page.getByText(/Benchmark provided by/i))
          .toBeVisible({ timeout: 60_000 });
      }
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(800);
      await shot(page, "energy-detail.png");

      // --- The Energieverbrauchsbenchmark walkthrough punchline
      //     (benchmark-payoff.png): a focused
      //     shot of the comparison table alone — A's own consumption now reads
      //     against the Benchmark column filled with the values C shared back.
      //     Embedded in the handbuch's "Energieverbrauchsbenchmark
      //     durchgespielt" walkthrough as the roundtrip's payoff.
      //     Local-only: it needs the seeded benchmark (remote keeps the
      //     committed figure). ---
      if (E2E_LOCAL) {
        await shotOf(
          page.locator("table").filter({
            has: page.locator("th", { hasText: "Benchmark kWh / a" }),
          }).first(),
          "benchmark-payoff.png",
        );
      }

      // Back to the app shell (the detail page is a standalone route without tabs).
      await page.goto("/#/");
      await expect(page.getByRole("tab", { name: "Manage" }))
        .toBeVisible({ timeout: 30_000 });
    }

    // --- Recipient side of sharing (shared-with-you.png): A shares its building
    //     with B by WebID, then B logs in fresh and we capture B's "Buildings
    //     shared with you" list — the payoff figure for the sharing chapter.
    //     Needs account B; when unset we keep the committed figure and skip. ---
    const B = account("B");
    if (!hasAccount(B)) {
      console.warn(
        "Account B not configured (E2E_USERNAME_B/PASSWORD_B); keeping the " +
          "committed shared-with-you.png and skipping its recapture.",
      );
      return;
    }
    const b = await freshPage(browser, B);
    try {
      // B's authoritative WebID is discovered after login (not built from creds).
      const bWebId = await webIdOf(b.page);

      // A shares its first building by B's WebID (mirrors manage.ts shareByWebId,
      // but targets the first row so it doesn't depend on a known street).
      await page.getByRole("tab", { name: "Manage" }).click();
      const aRow = page.locator("li").filter({
        has: page.getByRole("button", { name: "Share building data" }),
      }).first();
      await aRow.getByRole("button", { name: "Share building data" }).click();
      const shareDialog = page.getByRole("dialog");
      await expect(shareDialog).toBeVisible({ timeout: 10_000 });
      await shareDialog.getByRole("button", { name: /by webid/i }).click();
      const recipientInput = shareDialog.getByLabel(/Recipient WebID/i);
      await recipientInput.fill(bWebId);
      await recipientInput.press("Enter");
      const confirm = shareDialog.getByRole("button", { name: /confirm share/i });
      await expect(async () => {
        await shareDialog.getByRole("button", { name: /review and share/i }).click();
        await expect(confirm).toBeVisible({ timeout: 10_000 });
      }).toPass({ timeout: 90_000 });
      await confirm.click();
      await expect(shareDialog.getByText(/shared successfully/i))
        .toBeVisible({ timeout: 120_000 });
      await shareDialog.getByRole("button", { name: /done/i }).click();

      // Cooldown, then B drains its inbox by reloading (Login restores the
      // session → drainInbox archives the grant into shared-in/).
      await page.waitForTimeout(COOLDOWN_MS);
      await b.page.reload();
      await b.page.getByRole("tab", { name: "Share" }).click();
      await expect(
        b.page.getByRole("list", { name: /buildings shared with you/i })
          .getByText(/^Building /),
      ).toBeVisible({ timeout: 120_000 });
      // Local tier: B also contributed to the seeded benchmark, so the snapshot
      // Charlie shared back must show under "Views shared with you" — and the
      // figure shows the received PEER NUMBERS: expand it and wait for the
      // snapshot's averages (count line, value table, chart) to render.
      if (E2E_LOCAL) {
        await expect(b.page.getByText(BENCHMARK_NAME).first())
          .toBeVisible({ timeout: 120_000 });
        await b.page.getByRole("button", { name: "Show values" }).click();
        await expect(b.page.getByText(/across \d+ building/))
          .toBeVisible({ timeout: 60_000 });
        await b.page.locator("svg.recharts-surface .recharts-bar-rectangle")
          .first().waitFor({ timeout: 60_000 });
      }
      // Dismiss B's fresh-Pod "No buildings yet" banner if present (B owns
      // nothing on the remote tier; bounded no-op when absent) and let the
      // inbox-drain network settle before the shot.
      await b.page.getByRole("button", { name: "No thanks" })
        .click({ timeout: 8_000 }).catch(() => {});
      await b.page.waitForLoadState("networkidle").catch(() => {});
      await b.page.evaluate(() => globalThis.scrollTo(0, 0));
      await b.page.waitForTimeout(800);
      await shot(b.page, "shared-with-you.png");

      // --- The Vertriebsoptimierung walkthrough punchline (teilen-payoff.png):
      //     B's Explore map with
      //     A's shared building SELECTED — the orange shared pin next to B's
      //     own (blue) buildings, and the detail panel reading A's master data
      //     live from A's Pod. Local-only: it needs the seeded share (remote
      //     keeps the committed figure). ---
      if (E2E_LOCAL) {
        await b.page.getByRole("tab", { name: "Explore" }).click();
        const sharedMarker = b.page
          .locator(".leaflet-marker-icon.pin-shared").first();
        await sharedMarker.waitFor({ timeout: 60_000 });
        await b.page.waitForLoadState("networkidle").catch(() => {});
        await waitForMapTiles(b.page);
        await b.page.waitForTimeout(1500); // let markers/logos settle
        await sharedMarker.click();
        await expect(b.page.getByRole("tab", { name: "Building data" }))
          .toBeVisible({ timeout: 60_000 });
        await b.page.waitForLoadState("networkidle").catch(() => {});
        await b.page.waitForTimeout(800);
        await b.page.evaluate(() => globalThis.scrollTo(0, 0));
        await shot(b.page, "teilen-payoff.png");
      }
    } finally {
      await b.ctx.close();
    }
  });
});

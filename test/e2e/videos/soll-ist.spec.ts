import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { account, hasAccount, login } from "../helpers/login.ts";
import { setDevMode } from "../helpers/accountMenu.ts";
import { exploreRoute } from "../helpers/manage.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { Demo } from "./demoPolish.ts";

/**
 * Records the first handbuch video — the Soll-Ist-Vergleich walkthrough
 * („Soll-Ist-Vergleich durchgespielt": one actor, one session, no cuts) — by
 * driving the logged-in app with the demo polish (fake cursor, German step
 * captions, actor badge; `demoPolish.ts`). LOCAL tier only:
 *
 *   deno task videos
 *
 * Playwright records one video PER PAGE, and its video time compresses during
 * long idle stretches — wall-clock scene marks drift against it. So the noisy
 * setup (login, seeding, demo buildings) happens on the fixture page, and the
 * scenes run on a FRESH page in the same context (the app session restores
 * silently, as on a reload): that page's recording starts seconds before
 * scene 1, keeping the marks honest. Recording + marks land in
 * `test-results/videos/` (`soll-ist.webm` + `soll-ist.marks.json`);
 * `postprocess.sh soll-ist` trims the restore head and converts to MP4.
 * Hosting/distribution of the result is still an open decision
 * (notes/plan-handbuch-videos.md), so nothing is committed.
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;
const OUT = "test-results/videos";
const ACC = account("A");
/** The demo building the year is entered on (richest of the seeded four). */
const BUILDING = "Nordostpark";
const YEAR = "2025";

async function controlSeed(path: string): Promise<Response> {
  const res = await fetch(
    `http://localhost:${LOCAL_CSS_CONTROL_PORT}${path}`,
    { method: "POST" },
  );
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}: ${await res.text()}`);
  return res;
}

async function dismissToasts(page: Page) {
  await page.getByRole("button", { name: /^close$/i }).first()
    .click({ timeout: 4_000 }).catch(() => {});
}

test.describe("handbuch video: Soll-Ist-Vergleich", () => {
  test.skip(!E2E_LOCAL, "videos are recorded on the local tier (deno task videos)");
  test.skip(!hasAccount(ACC), "local seeded account A missing");

  test("record", async ({ page }) => {
    test.setTimeout(900_000);

    // --- Setup (on the fixture page; its video is discarded): login,
    //     identities, demo buildings — the walkthrough assumes a building. ---
    await login(page, ACC);
    await controlSeed("/seed-profiles");
    await page.reload();
    await expect(page.getByRole("tab", { name: "Connect" }))
      .toBeVisible({ timeout: 60_000 });
    await setDevMode(page, false);
    // The fresh-Pod onboarding banner appears once the (empty) buildings query
    // settles — wait for it rather than poll-and-skip (the pod is reset per
    // spec file, so it always comes).
    const addExamples = page.getByRole("button", { name: "Add examples" });
    await expect(addExamples).toBeVisible({ timeout: 60_000 });
    await addExamples.click();
    await expect(page.getByText("Demo buildings and energy data added").first())
      .toBeVisible({ timeout: 300_000 });
    await page.getByRole("tab", { name: "Manage" }).click();
    const setupRow = page.locator("li", { hasText: BUILDING }).first();
    await expect(setupRow).toBeVisible({ timeout: 60_000 });
    const buildingId = await setupRow.getAttribute("data-building-id");

    // --- The stage: a fresh page (= a fresh recording) in the same context.
    //     The app restores the session silently, like on a reload. ---
    const stage = await page.context().newPage();
    const t0 = Date.now();
    await stage.goto("/");
    await expect(stage.getByRole("tab", { name: "Manage" }))
      .toBeVisible({ timeout: 60_000 });
    await stage.getByRole("tab", { name: "Manage" }).click();
    const row = stage.locator("li", { hasText: BUILDING }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await stage.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stage);
    const demo = await Demo.install(stage, "A", t0);

    // --- Scene zero: establish the actor and her problem before the
    //     resolution starts. ---
    await demo.intro("Soll-Ist-Vergleich", [
      {
        slot: "A",
        tagline:
          "Bestandshalterin und Nutzerin ihrer Hallen: Hält der reale Verbrauch, was der Plan verspricht?",
      },
    ]);

    // --- Scene 1: the actual (Ist) year, in the per-building energy dialog. ---
    await demo.scene(
      "ist",
      "A erfasst für ihr Gebäude die tatsächlichen Verbräuche eines Jahres",
    );
    await demo.click(row.getByRole("button", { name: "Add or edit energy year" }));
    const dialog = stage.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await demo.type(
      stage.getByRole("spinbutton", { name: "Year", exact: true }),
      YEAR,
    );
    await demo.type(
      stage.getByRole("spinbutton", { name: "Electricity (kWh)" }),
      "98000",
    );
    await demo.type(stage.getByRole("spinbutton", { name: "Heat (kWh)" }), "64000");
    await demo.click(stage.getByRole("button", { name: "Save" }));
    await expect(stage.getByText("Energy data saved").first())
      .toBeVisible({ timeout: 60_000 });
    await demo.click(stage.getByRole("button", { name: "Close" }));
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // --- Scene 2: the planned (Soll) entry for the same year. ---
    await demo.scene(
      "soll",
      "Für dasselbe Jahr legt A einen Plan-Eintrag an: Scenario „Planned (Soll)“",
    );
    await demo.click(row.getByRole("button", { name: "Add or edit energy year" }));
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await demo.type(
      stage.getByRole("spinbutton", { name: "Year", exact: true }),
      YEAR,
    );
    await demo.select(stage.getByLabel("Scenario", { exact: true }), /^Planned/);
    await demo.type(
      stage.getByRole("spinbutton", { name: "Electricity (kWh)" }),
      "90000",
    );
    await demo.type(stage.getByRole("spinbutton", { name: "Heat (kWh)" }), "60000");
    await demo.click(stage.getByRole("button", { name: "Save" }));
    await expect(stage.getByText("Energy data saved").first())
      .toBeVisible({ timeout: 60_000 });
    await demo.click(stage.getByRole("button", { name: "Close" }));
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // --- Scene 3: the payoff — plan next to actual in the annual overview.
    //     Land on the building first (the deep link reads as a scene cut),
    //     settle, then switch to Energy data with a VISIBLE click — a raw
    //     `?dt=energy` teleport was too fast to follow. ---
    await demo.scene(
      "payoff",
      "Im Explore-Tab zeigt die Jahresübersicht Soll und Ist nebeneinander",
    );
    await stage.goto(exploreRoute(buildingId));
    await expect(stage.getByRole("tab", { name: "Building data" }))
      .toBeVisible({ timeout: 60_000 });
    await stage.waitForLoadState("networkidle").catch(() => {});
    await demo.pause(1_500);
    await demo.click(stage.getByRole("tab", { name: "Energy data" }));
    const planned = stage.getByText(/\(planned\)/i).first();
    await expect(planned).toBeVisible({ timeout: 60_000 });
    await stage.waitForLoadState("networkidle").catch(() => {});
    await demo.pause(1_200);
    await demo.moveTo(planned);
    await demo.pause(2_000);
    await demo.caption(
      "Der Soll-Ist-Vergleich: auf einen Blick, wie nah der Verbrauch am Plan liegt",
      4_000,
    );
    await demo.caption("");
    await demo.pause(800);
    await demo.outro();

    // --- Save the stage recording + scene marks. The video file is complete
    //     only once its page closes, so close first, then export. ---
    const video = stage.video();
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/soll-ist.marks.json`, JSON.stringify(demo.marks, null, 2));
    await stage.close();
    await video?.saveAs(`${OUT}/soll-ist.webm`);
  });
});

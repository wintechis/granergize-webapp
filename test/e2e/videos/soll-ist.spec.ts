import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { account, hasAccount, login } from "../helpers/login.ts";
import { METRIC_ELEC, METRIC_HEAT, vt, VID_LOCALE, VID_OUT } from "./lang.ts";
import { buildingRoute } from "../helpers/manage.ts";
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
 * The app renders in GERMAN: the context locale is `de-DE` and every app locator
 * resolves through the message catalog via `vt(key)` (i18n-driven — the same
 * spec would work in any locale).
 *
 * Playwright records one video PER PAGE, and its video time compresses during
 * long idle stretches — wall-clock scene marks drift against it. So the noisy
 * setup (login, seeding, demo buildings) happens on the fixture page, and the
 * scenes run on a FRESH page in the same context (the app session restores
 * silently, as on a reload): that page's recording starts seconds before
 * scene 1, keeping the marks honest. `postprocess.sh soll-ist` trims the restore
 * head and converts to MP4. Artifacts land in `test-results/videos/` and stay
 * uncommitted.
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;
const OUT = VID_OUT;
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
  await page.getByRole("button", { name: /^(close|schließen)$/i }).first()
    .click({ timeout: 4_000 }).catch(() => {});
}

test.describe("handbuch video: Soll-Ist-Vergleich", () => {
  test.use({ locale: VID_LOCALE }); // render the app in German
  test.skip(!E2E_LOCAL, "videos are recorded on the local tier (deno task videos)");
  test.skip(!hasAccount(ACC), "local seeded account A missing");

  test("record", async ({ page }) => {
    test.setTimeout(900_000);

    // --- Setup (on the fixture page; its video is discarded): login,
    //     identities, demo buildings — the walkthrough assumes a building.
    //     (Dev mode defaults OFF in a fresh context — no setDevMode, whose
    //     account-menu locators are English-only.) ---
    await login(page, ACC);
    await controlSeed("/seed-profiles");
    await page.reload();
    await expect(page.getByRole("tab", { name: vt("navBuildings") }))
      .toBeVisible({ timeout: 60_000 });
    // The fresh-Pod onboarding banner appears once the (empty) buildings query
    // settles — wait for it rather than poll-and-skip (the pod is reset per
    // spec file, so it always comes).
    const addExamples = page.getByRole("button", { name: vt("onboardAddExamples") });
    await expect(addExamples).toBeVisible({ timeout: 60_000 });
    await addExamples.click();
    await expect(page.getByText(vt("demoBuildingsAdded")).first())
      .toBeVisible({ timeout: 300_000 });
    await page.getByRole("tab", { name: vt("navBuildings") }).click();
    await page.getByRole("button", { name: vt("btnList") }).click();
    const setupRow = page.locator("li", { hasText: BUILDING }).first();
    await expect(setupRow).toBeVisible({ timeout: 60_000 });
    const buildingId = await setupRow.getAttribute("data-building-id");

    // --- The stage: a fresh page (= a fresh recording) in the same context.
    //     The app restores the session silently, like on a reload. ---
    const stage = await page.context().newPage();
    const t0 = Date.now();
    await stage.goto("/");
    await expect(stage.getByRole("tab", { name: vt("navBuildings") }))
      .toBeVisible({ timeout: 60_000 });
    await stage.getByRole("tab", { name: vt("navBuildings") }).click();
    await stage.getByRole("button", { name: vt("btnList") }).click();
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
          "Bestandshalterin und Betreiberin ihrer Hallen: Sie hat sich Einsparungen vorgenommen – liefert der Betrieb sie auch?",
      },
    ]);

    // --- Scene 1: the actual (Ist) year, in the per-building energy dialog. ---
    await demo.scene(
      "ist",
      "Zuerst das Ist: A trägt die tatsächlichen Jahresverbräuche ihres Gebäudes ein",
    );
    // Energy entry lives on the building's observation (energy) page — land there,
    // then open the year dialog via its "Edit energy years" button (hardcoded,
    // not localized, so it reads the same in de).
    await stage.goto(buildingRoute("observation", buildingId));
    const editYears = stage.getByRole("button", { name: "Edit energy years" });
    await expect(editYears).toBeVisible({ timeout: 60_000 });
    await stage.waitForLoadState("networkidle").catch(() => {});
    await demo.pause(1_200);
    await demo.click(editYears);
    const dialog = stage.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await demo.type(
      stage.getByRole("spinbutton", { name: vt("lblYear"), exact: true }),
      YEAR,
    );
    await demo.type(stage.getByRole("spinbutton", { name: METRIC_ELEC }), "98000");
    await demo.type(stage.getByRole("spinbutton", { name: METRIC_HEAT }), "64000");
    await demo.click(stage.getByRole("button", { name: vt("btnSave"), exact: true }));
    await expect(stage.getByText(vt("energySaved")).first())
      .toBeVisible({ timeout: 60_000 });
    await demo.click(stage.getByRole("button", { name: vt("btnClose"), exact: true }));
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // --- Scene 2: the planned (Soll) entry for the same year. ---
    await demo.scene(
      "soll",
      `Dann das Soll: für dasselbe Jahr ein Plan-Wert – das Szenario „${vt("scenarioPlanned")}“ hält ihn getrennt vom Ist`,
    );
    await demo.click(editYears);
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await demo.type(
      stage.getByRole("spinbutton", { name: vt("lblYear"), exact: true }),
      YEAR,
    );
    await demo.select(stage.getByLabel(vt("lblScenario"), { exact: true }), vt("scenarioPlanned"));
    await demo.type(stage.getByRole("spinbutton", { name: METRIC_ELEC }), "90000");
    await demo.type(stage.getByRole("spinbutton", { name: METRIC_HEAT }), "60000");
    await demo.click(stage.getByRole("button", { name: vt("btnSave"), exact: true }));
    await expect(stage.getByText(vt("energySaved")).first())
      .toBeVisible({ timeout: 60_000 });
    await demo.click(stage.getByRole("button", { name: vt("btnClose"), exact: true }));
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // --- Scene 3: the payoff — plan next to actual in the annual overview. The
    //     "(planned)" marker is hardcoded English even in the de UI, so it stays
    //     a reliable target. Land there as a scene cut and settle. ---
    await demo.scene(
      "payoff",
      "Die Jahresübersicht stellt Soll und Ist desselben Jahres direkt gegenüber",
    );
    await stage.goto(buildingRoute("observation", buildingId));
    const planned = stage.getByText(/\(planned\)/i).first();
    await expect(planned).toBeVisible({ timeout: 60_000 });
    await stage.waitForLoadState("networkidle").catch(() => {});
    await demo.pause(1_500);
    await stage.waitForLoadState("networkidle").catch(() => {});
    await demo.pause(1_200);
    await demo.moveTo(planned);
    await demo.pause(2_000);
    await demo.caption(
      "Soll-Ist-Vergleich: sofort sichtbar, ob der Verbrauch den Plan einhält – Grundlage für Nachsteuern und Budget",
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

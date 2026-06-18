import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { account, hasAccount, login } from "../helpers/login.ts";
import { vt, VID_LOCALE, VID_OUT } from "./lang.ts";
import { buildingRoute } from "../helpers/manage.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { Demo } from "./demoPolish.ts";

/**
 * Records the use-case-#4 video — the **Standort-Potenzial-Radar** walkthrough: a
 * single actor opens her building's detail page and reads the "Standort-Energieprofil"
 * panel, a radar of money/resource opportunities for the location, assembled from open
 * Linked-Data wrappers (`linked-energieatlas` + `linked-mastr`). LOCAL tier only:
 *
 *   deno task videos
 *
 * The seeded "Nordostpark" demo building is in Nürnberg (Bayern) and is geocoded at
 * seed time, so the panel populates: the Energie-Atlas serves Bavaria and MaStR is
 * nationwide. The panel is read-only, so this is a pure showcase — no data entry.
 *
 * Same recording discipline as `soll-ist.spec.ts`: noisy setup on the fixture page,
 * scenes on a FRESH page in the same context; `postprocess.sh standort-energieprofil` trims
 * the restore head and converts to MP4.
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;
const OUT = VID_OUT;
const ACC = account("A");
/** The Bavarian demo building whose location the radar reads. */
const BUILDING = "Nordostpark";

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

test.describe("handbuch video: Standort-Potenzial-Radar", () => {
  test.use({ locale: VID_LOCALE }); // render the app in German
  test.skip(!E2E_LOCAL, "videos are recorded on the local tier (deno task videos)");
  test.skip(!hasAccount(ACC), "local seeded account A missing");

  test("record", async ({ page }) => {
    test.setTimeout(900_000);

    // --- Setup (fixture page, video discarded): login, identities, demo
    //     buildings (geocoded at seed time, so Nordostpark gets coordinates). ---
    await login(page, ACC);
    await controlSeed("/seed-profiles");
    await page.reload();
    await expect(page.getByRole("tab", { name: vt("navBuildings") }))
      .toBeVisible({ timeout: 60_000 });
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

    // --- The stage: a fresh page (= a fresh recording) in the same context. ---
    const stage = await page.context().newPage();
    const t0 = Date.now();
    await stage.goto("/");
    await expect(stage.getByRole("tab", { name: vt("navBuildings") }))
      .toBeVisible({ timeout: 60_000 });
    await dismissToasts(stage);
    const demo = await Demo.install(stage, "A", t0);

    // --- Scene zero: the actor and the question the radar answers. ---
    await demo.intro("Standort-Potenzial-Radar", [
      {
        slot: "A",
        tagline:
          "Betreiberin ihrer Logistikhalle: Wo lässt sich am Standort Geld verdienen oder sparen?",
      },
    ]);

    // --- Scene 1: open the building, land on the Standort-Energieprofil panel. ---
    await demo.scene(
      "radar",
      "Das Standort-Energieprofil bündelt offene Daten zum Standort – Chancen statt Historie",
    );
    await stage.goto(buildingRoute("building", buildingId));
    const profile = stage.getByText(vt("secStandortProfile")).first();
    // The panel fills after two chained fetches (nearby MaStR → Gemeinde AGS →
    // Energie-Atlas), so give it room to arrive.
    await expect(profile).toBeVisible({ timeout: 90_000 });
    await stage.waitForLoadState("networkidle").catch(() => {});
    await demo.moveTo(profile);
    await demo.pause(1_500);

    // --- Scene 2: the rooftop Ausbaulücke — the headline opportunity. ---
    await demo.scene("rooftop", "Zuerst das Dach: wie viel Photovoltaik-Potenzial ist noch frei?");
    await demo.moveTo(stage.getByText(vt("sepRooftopPv")).first());
    await demo.caption(
      "Dach-Photovoltaik: Potenzial gegen Installiertes – die Ausbaulücke zeigt das ungenutzte Dach",
      3_800,
    );
    await demo.caption("");

    // --- Scene 3: ground-mounted PV. ---
    await demo.scene("ground", "Auch Freiflächen zählen – Höfe und Parkplätze");
    await demo.moveTo(stage.getByText(vt("sepGroundPv")).first());
    await demo.caption("Freiflächen-Photovoltaik: weiteres Potenzial direkt am Standort", 3_200);
    await demo.caption("");

    // --- Scene 4: how green the local grid is. ---
    await demo.scene("green", "Wie grün ist der Strom vor Ort?");
    await demo.moveTo(stage.getByText(vt("sepGreenElectricity")).first());
    await demo.caption(
      "Erneuerbarer Strom: Anteil am Verbrauch und der Mix nach Energieträger",
      3_200,
    );
    await demo.caption("");

    // --- Scene 5: what generation is already nearby. ---
    await demo.scene("nearby", "Und was steht schon in der Nähe?");
    await demo.moveTo(stage.getByText(vt("sepNearbyGeneration")).first());
    await demo.caption(
      "Erzeugung in der Nähe: bestehende Anlagen – lokaler Grünstrom zum Beziehen",
      3_500,
    );
    await demo.caption("");

    // --- Payoff. ---
    await demo.moveTo(profile);
    await demo.pause(1_000);
    await demo.caption(
      "Standort-Potenzial-Radar: konkrete Chancen aus offenen Daten – ohne eigene Recherche",
      4_000,
    );
    await demo.caption("");
    await demo.pause(800);
    await demo.outro();

    // --- Save the stage recording + scene marks (close the page first). ---
    const video = stage.video();
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/standort-energieprofil.marks.json`, JSON.stringify(demo.marks, null, 2));
    await stage.close();
    await video?.saveAs(`${OUT}/standort-energieprofil.webm`);
  });
});

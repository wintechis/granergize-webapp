import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { account, hasAccount, login } from "../helpers/login.ts";
import { VID_LANG, VID_LOCALE, VID_OUT, vt } from "./lang.ts";
import { importExampleBuildings } from "../helpers/seed.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { Demo } from "./demoPolish.ts";

/**
 * Records the use-case-#4 video — the **Standort-Potenzial-Radar** walkthrough: a
 * single actor opens her building's detail page and reads the "Standort-Energieprofil"
 * panel, a radar of money/resource opportunities for the location, assembled from open
 * Linked-Data wrappers (`linked-energieatlas` + `linked-mastr`), then closes on the region
 * **choropleth** (`/choropleth`, `linked-nuts`/`linked-lau` geometry shaded by the same
 * per-Gemeinde Energie-Atlas build-out). LOCAL tier only:
 *
 *   deno task videos
 *
 * The seeded "Thomas-Dachser-Str." demo building is in Nürnberg (Bayern) with
 * coordinates carried in the demo data, so the panel populates: the Energie-Atlas serves Bavaria and MaStR is
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
const BUILDING = "Thomas-Dachser-Str.";

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
    //     buildings (their coordinates ship in the demo data). ---
    await login(page, ACC);
    await controlSeed("/seed-profiles");
    await page.reload();
    await expect(page.getByRole("tab", { name: vt("navBuildings") }))
      .toBeVisible({ timeout: 60_000 });
    // Example buildings arrive through the file importer (there is no demo
    // seed): the helper drives the same "Autofill from file" flow a reader
    // would, in the video's locale.
    await importExampleBuildings(page, { lang: VID_LANG });
    await page.getByRole("tab", { name: vt("navBuildings") }).click();
    await page.getByRole("button", { name: vt("btnList") }).click();
    const setupRow = page.locator("li", { hasText: BUILDING }).first();
    await expect(setupRow).toBeVisible({ timeout: 60_000 });
    // The building's display name (the row heading) — its palette label, the text we
    // --- The stage: a fresh page (= a fresh recording) in the same context. ---
    const stage = await page.context().newPage();
    // The LLM launcher (the ">" natural-language path) is a Developer-mode affordance,
    // and the dev flag is read once at module init — set it BEFORE the stage loads so
    // the palette accepts NL. addInitScript re-runs on every load, so it always sticks.
    await stage.addInitScript(() => {
      try {
        localStorage.setItem("granergize.devMode", "1");
      } catch { /* storage disabled — ignore */ }
    });
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

    // --- Scene 1: reach the building via the command palette's LLM launcher — type
    //     the request in natural language; the launcher translates it to a ShowBuilding
    //     intent and resolves the NAME ("Thomas-Dachser-Str.") to the building's id, then jumps
    //     there. The launch navigates CLIENT-SIDE, so the warm session + demo overlay
    //     survive. ---
    await demo.scene(
      "palette",
      "Per Befehlspalette in natürlicher Sprache zum Gebäude",
    );
    await demo.click(stage.getByRole("button", { name: vt("paletteOpenAria") }));
    const paletteInput = stage.getByRole("textbox", { name: vt("palettePlaceholder") });
    await expect(paletteInput).toBeVisible({ timeout: 10_000 });
    await demo.type(paletteInput, `>zeige das Gebäude ${BUILDING}`);
    // Enter runs the LLM translation; wait for the reviewed intent JSON to land in the
    // field (the palette flips to JSON-review mode).
    await stage.keyboard.press("Enter");
    await expect(paletteInput).toHaveValue(/ShowBuilding/, { timeout: 60_000 });
    await demo.pause(1_500);
    // Enter launches the reviewed intent → resolves the name → navigates to the building.
    await stage.keyboard.press("Enter");

    // --- Scene 2: the Standort-Energieprofil panel on the building's page. ---
    await demo.scene(
      "radar",
      "Das Standort-Energieprofil bündelt offene Daten zum Standort – Chancen statt Historie",
    );
    const profile = stage.getByText(vt("secStandortProfile")).first();
    // The panel fills after two chained fetches (nearby MaStR → Gemeinde AGS →
    // Energie-Atlas), so give it room to arrive.
    await expect(profile).toBeVisible({ timeout: 90_000 });
    // The Energie-Atlas rooftop card arrives via the chained fetch (coords → MaStR →
    // Gemeinde AGS → Energie-Atlas), AFTER the section header (which the faster nearby /
    // LoD2 cards already paint); wait for it so the rooftop scene's moveTo finds it.
    await expect(stage.getByText(vt("sepRooftopPv")).first())
      .toBeVisible({ timeout: 90_000 });
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

    // --- Scene 6: the regional view — the rooftop Ausbaulücke across the Gemeinden
    //     of the area, as the neighbourhood choropleth on the SAME building page
    //     (linked-lau geometry + linked-energieatlas per-Gemeinde build-out). ---
    await demo.scene(
      "region",
      "Und im regionalen Bild: die Ausbaulücke über die Gemeinden der Umgebung",
    );
    // Scroll on down to the neighbourhood map (just below the Standort-Energieprofil
    // panel — same page, no navigation).
    const neighbourhood = stage.getByText(vt("neighbourhoodTitle")).first();
    await demo.moveTo(neighbourhood);
    await expect(neighbourhood).toBeVisible({ timeout: 60_000 });
    await stage.waitForLoadState("networkidle").catch(() => {});
    // One Energie-Atlas GET per visible Bavarian Gemeinde resolves the shading — give
    // them a beat to fill in before the caption.
    await demo.pause(6_000);
    await demo.caption(
      "Hell = wenig erschlossen, dunkel = viel: die Standort-Chance im regionalen Vergleich",
      4_500,
    );
    await demo.caption("");

    // --- Scene 7: amtliche Regionalstatistik — beyond the location potential, the
    //     official statistics (Regionalstatistik/Destatis) put the building's
    //     Bundesland/Kreis in context. Same page, just below the
    //     Standort-Energieprofil. Show the table, then switch to the choropleth.
    //     (Live data: the Regionalstatistik wrapper must be reachable at record
    //     time, like the Energie-Atlas above.) ---
    await demo.scene(
      "regional-stats",
      "Über das Standort-Potenzial hinaus: amtliche Regionalstatistik als Vergleich",
    );
    const regionalStats = stage.getByRole("group", { name: vt("regStatsViewAria") });
    await expect(regionalStats).toBeVisible({ timeout: 90_000 });
    await demo.moveTo(regionalStats);
    await demo.pause(1_200);
    await demo.caption(
      "Offene Daten der amtlichen Statistik – etwa der Anteil erneuerbaren Stroms im Bundesland, je Jahr",
      4_000,
    );
    await demo.caption("");
    // Switch from the table to the choropleth view (the regional-stats toggle only).
    await demo.click(regionalStats.getByRole("button", { name: vt("btnMap") }));
    await stage.waitForLoadState("networkidle").catch(() => {});
    await demo.pause(2_800);
    await demo.caption(
      "Als Karte: alle Regionen nach Kennzahl eingefärbt – das eigene Gebäude darin markiert",
      4_000,
    );
    await demo.caption("");

    // --- Payoff. ---
    await demo.pause(800);
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

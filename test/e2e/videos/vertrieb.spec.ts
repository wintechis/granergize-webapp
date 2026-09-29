import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { account, hasAccount, login, webIdOf } from "../helpers/login.ts";
import { VID_LANG, VID_LOCALE, VID_OUT, vt } from "./lang.ts";
import { importExampleBuildings } from "../helpers/seed.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { Demo, type SceneMark } from "./demoPolish.ts";

/**
 * Records the second handbuch video — the Vertriebsunterstützung walkthrough
 * („Vertriebsunterstützung durchgespielt": A shares a building, B sees it) —
 * the actor ladder's first PERSPECTIVE CUT: two clips, one per actor, each
 * recorded on its own staged page (per-page video, see soll-ist.spec.ts for
 * why) and concatenated in post:
 *
 *   deno task videos
 *   bash test/e2e/videos/postprocess.sh vertrieb vertrieb-a vertrieb-b
 *
 * The app renders in GERMAN (context locale `de-DE`); every app locator resolves
 * through the message catalog via `vt(key)` (i18n-driven).
 *
 * Clip A: Alice shares her hall with Bob by WebID (Teilen → Nach WebID → Prüfen
 * und teilen). Clip B: Bob's fresh app load drains the grant, the building shows
 * under "Freigaben", and on the map A's logo-marked hall stands among B's own
 * buildings — read live from A's Pod. B's own surroundings come from the control
 * server's `/seed-actor-buildings`. LOCAL tier only; artifacts land in
 * `test-results/videos/` and stay uncommitted.
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;
const OUT = VID_OUT;
const A = account("A");
const B = account("B");
/** A's hall that gets shared (the logistics demo, richest master data). */
const BUILDING = "Thomas-Dachser-Str.";
/** The "Gebäude <id>" prefix the shared-with-you list shows for a received building. */
const SHARED_PREFIX = new RegExp(`^${vt("shareBuildingN", { id: "" }).trim()} `);

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

/** Wait until the Leaflet tiles are drawn (see screenshots.spec.ts). */
async function waitForMapTiles(page: Page) {
  await page.waitForFunction(() => {
    const tiles = document.querySelectorAll(".leaflet-tile");
    return tiles.length > 0 &&
      Array.from(tiles).every((t) => t.classList.contains("leaflet-tile-loaded"));
  }, undefined, { timeout: 60_000 }).catch(() => {});
}

function saveMarks(name: string, marks: SceneMark[]) {
  writeFileSync(`${OUT}/${name}.marks.json`, JSON.stringify(marks, null, 2));
}

test.describe("handbuch video: Vertriebsunterstützung", () => {
  test.use({ locale: VID_LOCALE }); // render the app in German
  test.skip(!E2E_LOCAL, "videos are recorded on the local tier (deno task videos)");
  test.skip(!hasAccount(A) || !hasAccount(B), "local seeded accounts A+B missing");

  test("record", async ({ page, browser }) => {
    test.setTimeout(900_000);
    mkdirSync(OUT, { recursive: true });

    // --- Setup A (fixture page; its video is discarded): login, identities,
    //     demo buildings. (Dev mode defaults OFF in a fresh context — no
    //     setDevMode, whose account-menu locators are English-only.) ---
    await login(page, A);
    await controlSeed("/seed-profiles");
    await page.reload();
    await expect(page.getByRole("tab", { name: vt("navBuildings") }))
      .toBeVisible({ timeout: 60_000 });
    // Example buildings arrive through the file importer (there is no demo
    // seed): the helper drives the same "Autofill from file" flow a reader
    // would, in the video's locale.
    await importExampleBuildings(page, { lang: VID_LANG });

    // --- Setup B: own surroundings (seeded out-of-band), then a logged-in
    //     context of B's own (German + its own recordVideo). ---
    await controlSeed("/seed-actor-buildings?slot=B&n=2");
    const bCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      locale: VID_LOCALE,
      recordVideo: { dir: `${OUT}/.raw`, size: { width: 1280, height: 720 } },
    });
    const bSetup = await bCtx.newPage();
    await login(bSetup, B); // also self-provisions B's inbox for the grant
    const bWebId = await webIdOf(bSetup);

    // ============ Clip A: Alice shares her hall with Bob. ============
    const stageA = await page.context().newPage();
    const t0a = Date.now();
    await stageA.goto("/");
    await expect(stageA.getByRole("tab", { name: vt("navBuildings") }))
      .toBeVisible({ timeout: 60_000 });
    await stageA.getByRole("tab", { name: vt("navBuildings") }).click();
    await stageA.getByRole("button", { name: vt("btnList") }).click();
    const row = stageA.locator("li", { hasText: BUILDING }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await stageA.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageA);
    const demoA = await Demo.install(stageA, "A", t0a);

    // --- Scene zero: establish the cast and whose problem this solves. ---
    await demoA.intro("Vertriebsunterstützung", [
      {
        slot: "A",
        tagline:
          "Bestandshalterin: Ihre energieeffiziente Halle ist ein Verkaufsargument – wenn es belegbar ist",
      },
      {
        slot: "B",
        tagline:
          "Makler & Berater: Vermarktet die Halle und braucht dafür belastbare Energiedaten",
      },
    ]);

    // --- Scene: first contact — a WebID exchanged like an email address and
    //     remembered once in the address book, which resolves it to a person. ---
    await demoA.scene(
      "contact",
      "B's WebID hat A von ihm selbst – wie eine E-Mail-Adresse. Einmal ins Adressbuch:",
    );
    await demoA.click(stageA.getByRole("tab", { name: vt("navAgents") }));
    const webIdField = stageA.getByRole("textbox", { name: "WebID" });
    await webIdField.waitFor({ state: "visible", timeout: 30_000 });
    await demoA.type(webIdField, bWebId);
    await demoA.click(stageA.getByRole("button", { name: vt("agentAddAria") }));
    // The entry resolves to the person: name + avatar, no raw IRI.
    await expect(
      stageA.getByRole("list", { name: vt("navAgents") }).getByText("Bob Bauer"),
    ).toBeVisible({ timeout: 30_000 });
    await demoA.moveTo(stageA.getByRole("list", { name: vt("navAgents") }));
    await demoA.pause(2_000);
    await dismissToasts(stageA);

    await demoA.scene(
      "share-open",
      "A gibt ihr Gebäude für ihren Makler frei – direkt auf der Detailseite über „Teilen“",
    );
    // Sharing lives on the building's detail page. Back to the Buildings list,
    // open the building via its name link, then its "Teilen" button.
    await demoA.click(stageA.getByRole("tab", { name: vt("navBuildings") }));
    await demoA.click(stageA.getByRole("button", { name: vt("btnList") }));
    await expect(row).toBeVisible({ timeout: 60_000 });
    await demoA.click(row.locator('a[href*="/building?"]').first());
    const shareButton = stageA.getByRole("button", { name: vt("btnShare"), exact: true });
    await expect(shareButton).toBeVisible({ timeout: 60_000 });
    await stageA.waitForLoadState("networkidle").catch(() => {});
    await demoA.pause(1_000);
    await demoA.click(shareButton);
    const shareDialog = stageA.getByRole("dialog");
    await expect(shareDialog).toBeVisible({ timeout: 10_000 });

    await demoA.scene(
      "share-pick",
      "Als Empfänger schlägt die App B aus dem Adressbuch vor",
    );
    const recipient = shareDialog.getByLabel(vt("racLabel"));
    await demoA.click(recipient);
    await demoA.click(stageA.getByRole("option", { name: /Bob Bauer/ }));
    await demoA.pause(600);

    await demoA.scene(
      "share-confirm",
      "Prüfen und teilen: B erhält Lesezugriff – die Daten bleiben auf A's Pod, nichts wird kopiert",
    );
    await demoA.click(shareDialog.getByRole("button", { name: vt("shareReviewAndShare") }));
    const confirm = shareDialog.getByRole("button", { name: vt("shareConfirmShare") });
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    await demoA.click(confirm);
    // Success = the dialog swaps Confirm for a Done button (the "shared" message
    // itself is a global toast, not in-dialog).
    const shareDone = shareDialog.getByRole("button", { name: vt("btnDone") });
    await expect(shareDone).toBeVisible({ timeout: 120_000 });
    await demoA.pause(1_500);
    await demoA.click(shareDone);
    await expect(shareDialog).toBeHidden({ timeout: 10_000 });
    await demoA.caption("");
    await demoA.pause(800);

    const videoA = stageA.video();
    saveMarks("vertrieb-a", demoA.marks);
    await stageA.close();
    await videoA?.saveAs(`${OUT}/vertrieb-a.webm`);

    // ============ Clip B: Bob receives — list, map, live data. ============
    // Drain the grant on the DISCARDED setup page first (cf. the comment above
    // about map-fit ordering).
    await bSetup.reload();
    await bSetup.getByRole("tab", { name: vt("navSharing") }).click();
    await expect(bSetup.getByText(SHARED_PREFIX).first())
      .toBeVisible({ timeout: 120_000 });

    const stageB = await bCtx.newPage();
    const t0b = Date.now();
    await stageB.goto("/");
    await expect(stageB.getByRole("tab", { name: vt("navSharing") }))
      .toBeVisible({ timeout: 60_000 });
    await stageB.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageB);
    const demoB = await Demo.install(stageB, "B", t0b);
    // Let the initial Buildings map settle on B's own objects before leaving the tab
    // (the fit is once per mount; A's hall arrives a beat later and sits ~10 km away,
    // so it is framed in explicitly in the map scene below).
    await stageB.locator(".leaflet-marker-icon").first().waitFor({ timeout: 60_000 });

    const sharedEntry = stageB.getByText(SHARED_PREFIX).first();
    await demoB.scene(
      "received",
      "B (Bob Bauer) öffnet die App: A's Gebäude liegt unter „Freigaben“",
    );
    await demoB.click(stageB.getByRole("tab", { name: vt("navSharing") }));
    await expect(sharedEntry).toBeVisible({ timeout: 120_000 });
    await demoB.moveTo(sharedEntry);
    await demoB.pause(2_000);

    await demoB.scene(
      "map",
      "Auf der Karte: A's freigegebene Halle (orange markiert) neben B's eigenen Objekten",
    );
    await demoB.click(stageB.getByRole("tab", { name: vt("navBuildings") }));
    // Establish the List finder first so B's buildings (own + A's shared) load
    // before toggling to the map — otherwise the shared marker's click can fire
    // before the finder settles and never navigates.
    await demoB.click(stageB.getByRole("button", { name: vt("btnList") }));
    await stageB.locator("li[data-building-id]").first()
      .waitFor({ timeout: 60_000 });
    await demoB.click(
      stageB.getByLabel(vt("bldgsViewAria"))
        .getByRole("button", { name: vt("btnMap"), exact: true }),
    );
    const sharedMarker = stageB
      .locator(".leaflet-marker-icon.pin-shared").first();
    // The map framed B's own objects at street zoom; A's hall is ~10 km away and
    // leaflet.markercluster renders only the pins inside the viewport, so an off-screen
    // pin has no DOM node to wait for. Zoom out (Leaflet's own control, language-free)
    // until the shared pin is in view — which is also the scene: A's hall NEXT TO B's.
    const zoomOut = stageB.getByRole("button", { name: "Zoom out" });
    for (let i = 0; i < 7 && !(await sharedMarker.isVisible()); i++) {
      await demoB.click(zoomOut);
      await demoB.pause(500);
    }
    await sharedMarker.waitFor({ timeout: 60_000 });
    await waitForMapTiles(stageB);
    await demoB.pause(1_500);
    // The map is a pure finder: clicking the shared marker NAVIGATES to A's
    // building page (`/building?…`), where B reads A's data live.
    // Plain click, no cursor-hover: hovering a building marker opens its tooltip,
    // which then swallows the click; a direct click navigates to A's building page.
    // Click → nav, retried: a click can race the map's zoom/settle and be swallowed by
    // Leaflet (no nav). A BrowserRouter pushState nav fires no "load", so poll the URL
    // (`toHaveURL`) rather than `waitForURL` (cf. uri-state.spec).
    await expect(async () => {
      await sharedMarker.click({ force: true });
      await expect(stageB).toHaveURL(/\/building\?/, { timeout: 2_000 });
    }).toPass({ timeout: 60_000, intervals: [500] });

    await demoB.scene(
      "payoff",
      "B sieht A's Gebäude- und Energiedaten live aus A's Pod – und kann die Effizienz der Halle im Vertrieb belegen",
    );
    await expect(stageB).toHaveURL(/\/building\?/, { timeout: 60_000 });
    await stageB.waitForLoadState("networkidle").catch(() => {});
    await demoB.pause(2_000);
    await demoB.caption(
      "Vertriebsunterstützung: echte Energiedaten als Verkaufsargument – die Datenhoheit bleibt bei der Eigentümerin",
      4_000,
    );
    await demoB.caption("");
    await demoB.pause(800);
    await demoB.outro();

    const videoB = stageB.video();
    saveMarks("vertrieb-b", demoB.marks);
    await stageB.close();
    await videoB?.saveAs(`${OUT}/vertrieb-b.webm`);
    await bCtx.close();
  });
});

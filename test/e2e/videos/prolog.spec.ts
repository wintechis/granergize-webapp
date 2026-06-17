import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { account, hasAccount, login, webIdOf } from "../helpers/login.ts";
import { METRIC_ELEC, METRIC_HEAT, vt, VID_LOCALE, VID_OUT } from "./lang.ts";
import { buildingRoute } from "../helpers/manage.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { Demo, type SceneMark } from "./demoPolish.ts";

/**
 * Records the complete-onboarding handbuch video — the Granergize „Prolog",
 * the partner checklist (docs/uwe-1.md) end to end, starting from nothing:
 *
 *   - create a Solid Pod (driven on the identity provider's own sign-up UI —
 *     the Community Solid Server `.account` pages — OUTSIDE the app)
 *   - set up the organisation: name + logo
 *   - add a building (coordinates via the geocode button) + two years of energy
 *     incl. a Soll (Planned) value
 *   - share the building directly with another user by WebID (read-only)
 *   - revoke the access again
 *
 * The data room (Datenzimmer) is NOT shown here — sharing is the simple direct-
 * WebID path; the room/role flow has its own video (datenzimmer.spec.ts).
 *
 * The app renders in GERMAN: the context locale is `de-DE`, and every app
 * locator resolves through the message catalog via `vt(key)` (i18n-driven, so
 * the same spec would work in any locale). Only the CSS provider's own sign-up
 * pages stay English — they are not part of the app's i18n.
 *
 *   deno task videos
 *   bash test/e2e/videos/postprocess.sh prolog prolog-pod prolog-a prolog-b prolog-a2
 *
 * The Pod sign-up is an illustrative prolog (a throwaway `alice-ahlmann`
 * account) recorded in its OWN context so its identity-provider session can't
 * disturb the seeded Alice's silent restore in the app clips; a scene-cut then
 * continues as the seeded Alice, whose pod carries no organisation yet (only B
 * is profile-seeded) so she sets up her org + logo on camera. Each clip records
 * on its own staged page (per-page video — see soll-ist.spec.ts). LOCAL tier
 * only; artifacts land in `test-results/videos/` and stay uncommitted.
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;
const OUT = VID_OUT;
const A = account("A");
const B = account("B");
/** The building Alice adds and threads through every step (display name = street). */
const STREET = "Nordostpark 93";
/** Alice's organisation logo, uploaded on camera (an SVG fixture). */
const ORG_LOGO = "test/e2e/fixtures/ahlmann-logistik-logo.svg";

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

/** Wait until the Leaflet tiles are drawn (see vertrieb.spec.ts). */
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

/** Open the per-building energy-year dialog (German UI), write one year, save, close. */
async function enterEnergyYear(
  demo: Demo,
  stage: Page,
  year: string,
  electricity: string,
  heat: string,
  scenario?: string,
) {
  // "Edit energy years" is hardcoded (not localized), so it reads the same in de.
  await demo.click(stage.getByRole("button", { name: "Edit energy years" }));
  const dialog = stage.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await demo.type(
    stage.getByRole("spinbutton", { name: vt("lblYear"), exact: true }),
    year,
  );
  if (scenario) {
    await demo.select(stage.getByLabel(vt("lblScenario"), { exact: true }), scenario);
  }
  await demo.type(stage.getByRole("spinbutton", { name: METRIC_ELEC }), electricity);
  await demo.type(stage.getByRole("spinbutton", { name: METRIC_HEAT }), heat);
  await demo.click(stage.getByRole("button", { name: vt("btnSave"), exact: true }));
  await expect(stage.getByText(vt("energySaved")).first())
    .toBeVisible({ timeout: 60_000 });
  await demo.click(stage.getByRole("button", { name: vt("btnClose"), exact: true }));
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

test.describe("handbuch video: Prolog", () => {
  test.use({ locale: VID_LOCALE }); // render the app in German
  test.skip(!E2E_LOCAL, "videos are recorded on the local tier (deno task videos)");
  test.skip(!hasAccount(A) || !hasAccount(B), "local seeded accounts A+B missing");

  test("record", async ({ page, browser }) => {
    test.setTimeout(1_200_000);
    mkdirSync(OUT, { recursive: true });

    // --- Setup A (fixture page; its video is discarded): login. Seed ONLY B's
    //     profile (the recipient's name) so A's pod has no organisation — she
    //     sets up her org + logo on camera. No demo buildings either. ---
    await login(page, A);
    await controlSeed("/seed-profiles?slots=B");
    await page.reload();
    await expect(page.getByRole("tab", { name: vt("navBuildings") }))
      .toBeVisible({ timeout: 60_000 });
    // Dev mode defaults OFF in a fresh context — no setDevMode needed (and its
    // account-menu locators are English-only, which a de-DE context would miss).

    // --- Setup B: a logged-in context of B's own (German locale + its own
    //     recordVideo; self-provisions B's inbox for the grant). ---
    const bCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      locale: VID_LOCALE,
      recordVideo: { dir: `${OUT}/.raw`, size: { width: 1280, height: 720 } },
    });
    const bSetup = await bCtx.newPage();
    await login(bSetup, B);
    const bWebId = await webIdOf(bSetup);

    // ============ Clip 0 (prolog): create a Solid Pod on the provider's own
    //     sign-up UI (the Community Solid Server `.account` pages, OUTSIDE the
    //     app; ENGLISH). Recorded in its OWN throwaway context so the new
    //     account's identity-provider session can't break the seeded Alice's
    //     silent restore in the app clips. ============
    const cssBase = A.provider.issuer.replace(/\/$/, "");
    const podCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: `${OUT}/.raw`, size: { width: 1280, height: 720 } },
    });
    const podPage = await podCtx.newPage();
    const t0pod = Date.now();
    await podPage.goto(`${cssBase}/.account/login/password/register/`);
    await expect(podPage.getByRole("heading", { name: "Create account" }))
      .toBeVisible({ timeout: 60_000 });
    const demoPod = await Demo.install(podPage, "A", t0pod);

    await demoPod.intro("Granergize: von der Pod-Anmeldung bis zum Teilen", [
      {
        slot: "A",
        tagline:
          "Alice Ahlmann, Bestandshalterin: legt sich einen Pod an und pflegt ihre Daten dort",
      },
      {
        slot: "B",
        tagline:
          "Partner: erhält gezielt Lesezugriff auf einzelne Gebäude – nichts darüber hinaus",
      },
    ]);

    await demoPod.scene(
      "pod",
      "Schritt 0: Alice legt sich beim Anbieter einen eigenen Solid Pod an (außerhalb der App)",
    );
    await demoPod.type(podPage.locator("#email"), "alice@ahlmann-logistik.de");
    await demoPod.type(podPage.locator("#password"), "ahlmann-pw-12345");
    await demoPod.type(podPage.locator("#confirmPassword"), "ahlmann-pw-12345");
    await demoPod.click(podPage.getByRole("button", { name: "Register" }));
    await demoPod.caption("Konto angelegt – jetzt den eigentlichen Pod erzeugen.", 2_400);
    await demoPod.click(podPage.getByRole("link", { name: "Create pod" }));
    await expect(podPage.locator("#name")).toBeVisible({ timeout: 30_000 });
    await demoPod.type(podPage.locator("#name"), "alice-ahlmann");
    await demoPod.click(podPage.getByRole("button", { name: /^create pod$/i }));
    await expect(podPage.getByText(/your new pod is located at/i))
      .toBeVisible({ timeout: 30_000 });
    await demoPod.caption(
      "Der Pod gehört Alice – alle Daten liegen hier, unter ihrer Kontrolle.",
      3_500,
    );
    await demoPod.caption("");
    await demoPod.pause(600);

    const videoPod = podPage.video();
    saveMarks("prolog-pod", demoPod.marks);
    await podPage.close();
    await videoPod?.saveAs(`${OUT}/prolog-pod.webm`);
    await podCtx.close();

    // ============ Clip A: app login → org → building → energy → share. ============
    const stageA = await page.context().newPage();
    const t0a = Date.now();
    await stageA.goto("/");
    await expect(stageA.getByRole("tab", { name: vt("navBuildings") }))
      .toBeVisible({ timeout: 60_000 });
    await stageA.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageA);
    const demoA = await Demo.install(stageA, "A", t0a);

    await demoA.scene(
      "login",
      "Mit ihrem Pod meldet sich Alice in der Granergize-App an",
    );
    await demoA.pause(1_500);

    // --- Step 1: set up the organisation — name + logo. ---
    await demoA.scene(
      "org",
      "Schritt 1: Alice richtet ihre Organisation ein – Name und Logo",
    );
    await demoA.click(stageA.getByRole("button", { name: new RegExp(`^${vt("menuAccountAria")}`) }));
    await demoA.click(stageA.getByRole("menuitem", { name: vt("menuOrganisation") }));
    const orgDialog = stageA.getByRole("dialog");
    await expect(orgDialog).toBeVisible({ timeout: 10_000 });
    await demoA.type(orgDialog.getByLabel(vt("lblCompanyName")), "Ahlmann Logistik");
    // "Logo wählen…" opens a native file chooser the hidden <input type=file>
    // backs; capture the chooser event and hand it the SVG fixture.
    const [chooser] = await Promise.all([
      stageA.waitForEvent("filechooser"),
      demoA.click(orgDialog.getByRole("button", { name: vt("orgChooseLogo") })),
    ]);
    await chooser.setFiles(ORG_LOGO);
    await demoA.pause(1_000);
    await demoA.click(orgDialog.getByRole("button", { name: vt("btnSave"), exact: true }));
    await expect(stageA.getByText(vt("organisationSaved")).first())
      .toBeVisible({ timeout: 60_000 });
    await expect(orgDialog).toBeHidden({ timeout: 10_000 });
    await demoA.moveTo(
      stageA.getByRole("img", { name: vt("orgLogoAlt") }).first(),
    );
    await demoA.caption(
      "Das Logo erscheint nun in der App – und später an Alices Gebäuden auf der Karte.",
      3_000,
    );

    // --- Step 2: add a building; coordinates via the geocode button. ---
    await demoA.scene(
      "building",
      "Schritt 2: Alice legt ein Gebäude an – Koordinaten holt die App aus der Adresse",
    );
    await demoA.click(stageA.getByRole("tab", { name: vt("navBuildings") }));
    await demoA.click(stageA.getByRole("button", { name: vt("btnList") }));
    await demoA.click(
      stageA.getByRole("button", { name: vt("addBuildingBtn") }).first(),
    );
    const addDialog = stageA.getByRole("dialog");
    await expect(addDialog.getByLabel(vt("lblStreetAddress")))
      .toBeVisible({ timeout: 30_000 });
    await demoA.type(addDialog.getByLabel(vt("lblStreetAddress")), STREET);
    await demoA.type(addDialog.getByLabel(vt("lblLocality")), "Nürnberg");
    await demoA.type(addDialog.getByLabel(vt("lblPostalCode")), "90411");
    await demoA.type(addDialog.getByLabel(vt("lblRegion")), "Bayern");
    await demoA.click(addDialog.getByRole("button", { name: vt("addGetCoordinates") }));
    await expect(stageA.getByText(vt("coordinatesUpdated")).first())
      .toBeVisible({ timeout: 60_000 });
    await expect(addDialog.getByLabel(vt("lblLatitude"))).not.toHaveValue("", {
      timeout: 10_000,
    });
    await demoA.moveTo(addDialog.getByLabel(vt("lblLatitude")));
    await demoA.pause(1_200);
    await demoA.click(addDialog.getByRole("button", { name: vt("addBuildingBtn") }));
    await expect(addDialog).toBeHidden({ timeout: 60_000 });

    const row = stageA.locator("li[data-building-id]", { hasText: STREET }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    const buildingId = await row.getAttribute("data-building-id");
    if (!buildingId) throw new Error("no data-building-id on the added row");

    // --- Step 3: two years of actual energy + a planned (Soll) value. ---
    await demoA.scene(
      "energy",
      "Schritt 3: Alice erfasst zwei Jahre Verbrauch – und einen Soll-Wert (Plan)",
    );
    await stageA.goto(buildingRoute("observation", buildingId));
    await expect(stageA.getByRole("button", { name: "Edit energy years" }))
      .toBeVisible({ timeout: 60_000 });
    await stageA.waitForLoadState("networkidle").catch(() => {});
    await demoA.pause(1_000);
    await enterEnergyYear(demoA, stageA, "2024", "102000", "67000");
    await enterEnergyYear(demoA, stageA, "2025", "98000", "64000");
    await demoA.caption(`Für 2025 zusätzlich der Plan: Szenario „${vt("scenarioPlanned")}“`, 2_600);
    await enterEnergyYear(demoA, stageA, "2025", "90000", "60000", vt("scenarioPlanned"));

    // Payoff: the annual overview now carries both years + the plan. Land on the
    // observation page and settle on its (always-present) energy action — the
    // chart renders below it. (The annual "(planned)" marker is English-only and
    // the chart legend is SVG, so neither is a reliable de text target.)
    await stageA.goto(buildingRoute("observation", buildingId));
    const editBtn = stageA.getByRole("button", { name: "Edit energy years" });
    await expect(editBtn).toBeVisible({ timeout: 60_000 });
    await stageA.waitForLoadState("networkidle").catch(() => {});
    await demoA.pause(1_500);
    await demoA.moveTo(editBtn);
    await demoA.caption(
      "Soll und Ist nebeneinander: hält der reale Verbrauch, was der Plan verspricht?",
      3_500,
    );

    // --- Step 4: share the building directly with B by WebID (read-only). ---
    await demoA.scene(
      "share",
      "Schritt 4: Alice teilt das Gebäude direkt mit B – per WebID, B erhält nur Lesezugriff",
    );
    await stageA.goto(buildingRoute("building", buildingId));
    const shareButton = stageA.getByRole("button", { name: vt("btnShare"), exact: true });
    await expect(shareButton).toBeVisible({ timeout: 60_000 });
    await stageA.waitForLoadState("networkidle").catch(() => {});
    await demoA.click(shareButton);
    const shareDialog = stageA.getByRole("dialog");
    await expect(shareDialog).toBeVisible({ timeout: 10_000 });
    await demoA.click(shareDialog.getByRole("button", { name: vt("shareByWebId") }));
    const recipient = shareDialog.getByLabel(vt("racLabel"));
    await demoA.type(recipient, bWebId);
    await recipient.press("Enter");
    await demoA.pause(600);
    await demoA.click(shareDialog.getByRole("button", { name: vt("shareReviewAndShare") }));
    const confirm = shareDialog.getByRole("button", { name: vt("shareConfirmShare") });
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    await demoA.click(confirm);
    // Success = the dialog swaps Confirm for a Done button (the "shared" message
    // itself is a global toast, not in-dialog).
    const shareDone = shareDialog.getByRole("button", { name: vt("btnDone") });
    await expect(shareDone).toBeVisible({ timeout: 120_000 });
    await demoA.pause(1_200);
    await demoA.click(shareDone);
    await expect(shareDialog).toBeHidden({ timeout: 10_000 });
    await demoA.caption("");
    await demoA.pause(800);

    const videoA = stageA.video();
    saveMarks("prolog-a", demoA.marks);
    await stageA.close();
    await videoA?.saveAs(`${OUT}/prolog-a.webm`);

    // --- Drain the A→B grant on the DISCARDED setup page first (cf. vertrieb). ---
    await bSetup.reload();
    await bSetup.getByRole("tab", { name: vt("navSharing") }).click();
    await expect(
      bSetup.getByText(new RegExp(`^${vt("shareBuildingN", { id: "" }).trim()} `)).first(),
    ).toBeVisible({ timeout: 120_000 });

    // ============ Clip B: B receives the building. ============
    const stageB = await bCtx.newPage();
    const t0b = Date.now();
    await stageB.goto("/");
    await expect(stageB.getByRole("tab", { name: vt("navSharing") }))
      .toBeVisible({ timeout: 60_000 });
    await stageB.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageB);
    const demoB = await Demo.install(stageB, "B", t0b);

    const sharedEntry = stageB
      .getByText(new RegExp(`^${vt("shareBuildingN", { id: "" }).trim()} `)).first();
    await demoB.scene(
      "received",
      "B (Bob Bauer) sieht Alices Gebäude unter „Freigaben“",
    );
    await demoB.click(stageB.getByRole("tab", { name: vt("navSharing") }));
    await expect(sharedEntry).toBeVisible({ timeout: 120_000 });
    await demoB.moveTo(sharedEntry);
    await demoB.pause(2_000);

    // --- On the map: A's shared hall; clicking it reads A's data live. ---
    await demoB.scene(
      "map",
      "Auf der Karte: Alices freigegebene Halle (orange markiert)",
    );
    await demoB.click(stageB.getByRole("tab", { name: vt("navBuildings") }));
    await demoB.click(
      stageB.getByLabel(vt("bldgsViewAria"))
        .getByRole("button", { name: vt("btnMap"), exact: true }),
    );
    const sharedMarker = stageB.locator(".leaflet-marker-icon.pin-shared").first();
    await sharedMarker.waitFor({ timeout: 60_000 });
    await waitForMapTiles(stageB);
    await demoB.pause(1_500);
    await demoB.click(sharedMarker);

    await demoB.scene(
      "payoff",
      "B liest Alices Gebäude- und Energiedaten live aus Alices Pod",
    );
    await stageB.waitForURL(/\/building\?/, { timeout: 60_000 });
    await stageB.waitForLoadState("networkidle").catch(() => {});
    await demoB.pause(2_000);
    await demoB.caption("");

    const videoB = stageB.video();
    saveMarks("prolog-b", demoB.marks);
    await stageB.close();
    await videoB?.saveAs(`${OUT}/prolog-b.webm`);
    await bCtx.close();

    // ============ Clip A2: A revokes B's access again. ============
    const stageA2 = await page.context().newPage();
    const t0a2 = Date.now();
    await stageA2.goto(buildingRoute("building", buildingId));
    await expect(stageA2.getByRole("button", { name: vt("btnShare"), exact: true }))
      .toBeVisible({ timeout: 60_000 });
    await stageA2.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageA2);
    const demoA2 = await Demo.install(stageA2, "A", t0a2);

    await demoA2.scene(
      "revoke",
      "Schritt 5: Alice entzieht B den Zugriff – sofort wirksam",
    );
    const revoke = stageA2.getByRole("button", { name: vt("revokeAccess") }).first();
    await expect(revoke).toBeVisible({ timeout: 60_000 });
    await demoA2.moveTo(stageA2.getByText(vt("sharedWithLabel")).first());
    await demoA2.pause(1_200);
    await demoA2.click(revoke);
    await demoA2.click(stageA2.getByRole("button", { name: vt("confirmRevoke"), exact: true }));
    await expect(stageA2.getByText(vt("accessRevoked")).first())
      .toBeVisible({ timeout: 60_000 });
    await demoA2.pause(1_500);
    await demoA2.caption(
      "Eigener Pod, volle Kontrolle: gezielt teilen – und jederzeit wieder entziehen.",
      4_000,
    );
    await demoA2.caption("");
    await demoA2.pause(800);
    await demoA2.outro();

    const videoA2 = stageA2.video();
    saveMarks("prolog-a2", demoA2.marks);
    await stageA2.close();
    await videoA2?.saveAs(`${OUT}/prolog-a2.webm`);
  });
});

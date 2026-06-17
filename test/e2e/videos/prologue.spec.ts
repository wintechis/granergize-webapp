import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { account, hasAccount, login, webIdOf } from "../helpers/login.ts";
import { setDevMode } from "../helpers/accountMenu.ts";
import { exploreRoute } from "../helpers/manage.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { Demo, type SceneMark } from "./demoPolish.ts";

/**
 * Records the complete-onboarding handbuch video — the Granergize „Prologue"
 * that plays out Uwe's partner checklist (docs/uwe-1.md) end to end, from one
 * organisation's perspective, starting from nothing:
 *
 *   - create a Solid Pod (driven on the identity provider's own sign-up UI —
 *     the Community Solid Server `.account` pages — OUTSIDE the app)
 *   - set up the organisation: name + logo
 *   - add a building, enter two years of energy + a Soll (Planned) value
 *   - share the building directly with another user by WebID (read-only)
 *   - revoke the access again
 *
 * The data room (Datenzimmer) is NOT shown here — sharing is the simple direct-
 * WebID path; the room/role/invite flow has its own video (datenzimmer.spec.ts).
 *
 * Three actor clips with perspective cuts (cf. vertrieb.spec.ts), concatenated
 * in post into one MP4:
 *
 *   deno task videos
 *   bash test/e2e/videos/postprocess.sh prologue prologue-pod prologue-a prologue-b prologue-a2
 *
 * The Pod sign-up is an illustrative prologue on the CSS sign-up UI (a throwaway
 * `alice-ahlmann` account), recorded in its OWN context so its identity-provider
 * session can't disturb the seeded Alice's silent restore in the app clips; a
 * scene-cut then continues in the app as the seeded Alice, whose pod carries no
 * organisation yet (only B is profile-seeded) so she sets up her org + logo on
 * camera. Clip 0: sign up. Clip A: org/logo → building → energy (2024 + 2025
 * actual, 2025 plan) → share with B by WebID. Clip B: B finds A's building under
 * "Shared with you", reading it live off A's Pod. Clip A2: A revokes B's access.
 * Each clip records on its own staged page (per-page video — see soll-ist.spec.ts).
 * LOCAL tier only; artifacts land in `test-results/videos/` and stay uncommitted.
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;
const OUT = "test-results/videos";
const A = account("A");
const B = account("B");
/** The building A adds and threads through every step (a plain manual entry,
 * exactly what a partner does first — its display name is the street). */
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
  await page.getByRole("button", { name: /^close$/i }).first()
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

/** Open the Manage-row energy-year dialog, write one year, save, close. */
async function enterEnergyYear(
  demo: Demo,
  stage: Page,
  row: ReturnType<Page["locator"]>,
  year: string,
  electricity: string,
  heat: string,
  scenario?: RegExp,
) {
  await demo.click(row.getByRole("button", { name: "Add or edit energy year" }));
  const dialog = stage.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await demo.type(
    stage.getByRole("spinbutton", { name: "Year", exact: true }),
    year,
  );
  if (scenario) {
    await demo.select(stage.getByLabel("Scenario", { exact: true }), scenario);
  }
  await demo.type(
    stage.getByRole("spinbutton", { name: "Electricity (kWh)" }),
    electricity,
  );
  await demo.type(stage.getByRole("spinbutton", { name: "Heat (kWh)" }), heat);
  await demo.click(stage.getByRole("button", { name: "Save" }));
  await expect(stage.getByText("Energy data saved").first())
    .toBeVisible({ timeout: 60_000 });
  await demo.click(stage.getByRole("button", { name: "Close" }));
  await expect(dialog).toBeHidden({ timeout: 10_000 });
}

test.describe("handbuch video: Prologue", () => {
  test.skip(!E2E_LOCAL, "videos are recorded on the local tier (deno task videos)");
  test.skip(!hasAccount(A) || !hasAccount(B), "local seeded accounts A+B missing");

  test("record", async ({ page, browser }) => {
    test.setTimeout(1_200_000);
    mkdirSync(OUT, { recursive: true });

    // --- Setup A (fixture page; its video is discarded): login. Seed ONLY B's
    //     profile (the share recipient's name) so A's pod has no organisation —
    //     she sets up her org + logo on camera. No demo buildings either. ---
    await login(page, A);
    await controlSeed("/seed-profiles?slots=B");
    await page.reload();
    await expect(page.getByRole("tab", { name: "Connect" }))
      .toBeVisible({ timeout: 60_000 });
    await setDevMode(page, false);

    // --- Setup B: a logged-in context of B's own (self-provisions B's inbox so
    //     A's WebID grant can be delivered). Manual contexts don't inherit the
    //     project's video option — pass recordVideo explicitly. ---
    const bCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: `${OUT}/.raw`, size: { width: 1280, height: 720 } },
    });
    const bSetup = await bCtx.newPage();
    await login(bSetup, B);
    await setDevMode(bSetup, false);
    const bWebId = await webIdOf(bSetup);

    // ============ Clip 0 (prologue): create a Solid Pod on the provider's own
    //     sign-up UI (the Community Solid Server `.account` pages, OUTSIDE the
    //     app). Recorded in its OWN throwaway context: the sign-up leaves an
    //     identity-provider session for the new `alice-ahlmann` account, which
    //     would otherwise break the seeded Alice's silent session-restore in the
    //     app clips. The pod created here is illustrative — a scene-cut then
    //     continues in the app as the seeded Alice. ============
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

    // --- Scene zero: the cast and the problem this solves. ---
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
    saveMarks("prologue-pod", demoPod.marks);
    await podPage.close();
    await videoPod?.saveAs(`${OUT}/prologue-pod.webm`);
    await podCtx.close();

    // ============ Clip A: app login → org → data → room → share. ============
    const stageA = await page.context().newPage();
    const t0a = Date.now();
    await stageA.goto("/");
    await expect(stageA.getByRole("tab", { name: "Manage" }))
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
    await demoA.click(stageA.getByRole("button", { name: /^Account menu/ }));
    await demoA.click(stageA.getByRole("menuitem", { name: /organisation/i }));
    const orgDialog = stageA.getByRole("dialog");
    await expect(orgDialog).toBeVisible({ timeout: 10_000 });
    await demoA.type(orgDialog.getByLabel(/company name/i), "Ahlmann Logistik");
    // "Choose logo…" opens a native file chooser the hidden <input type=file>
    // backs; capture the chooser event and hand it the SVG fixture (no OS dialog
    // renders in headless, so the click reads as "picked a file").
    const [chooser] = await Promise.all([
      stageA.waitForEvent("filechooser"),
      demoA.click(orgDialog.getByRole("button", { name: /choose logo/i })),
    ]);
    await chooser.setFiles(ORG_LOGO);
    await demoA.pause(1_000);
    await demoA.click(orgDialog.getByRole("button", { name: /^save$/i }));
    await expect(stageA.getByText("Organisation saved").first())
      .toBeVisible({ timeout: 60_000 });
    await expect(orgDialog).toBeHidden({ timeout: 10_000 });
    // Payoff: the logo now rides in the app header (and later on Alice's marker).
    await demoA.moveTo(
      stageA.getByRole("img", { name: "Organisation logo" }).first(),
    );
    await demoA.caption(
      "Das Logo erscheint nun in der App – und später an Alices Gebäuden auf der Karte.",
      3_000,
    );

    // --- Step 2: add a building (address + location is enough). ---
    await demoA.scene(
      "building",
      "Schritt 2: Alice legt ein Gebäude an – Adresse und Standort genügen",
    );
    await demoA.click(stageA.getByRole("tab", { name: "Manage" }));
    await demoA.click(
      stageA.getByRole("button", { name: /^add building$/i }).first(),
    );
    const addDialog = stageA.getByRole("dialog");
    await expect(addDialog.getByLabel(/street address/i))
      .toBeVisible({ timeout: 30_000 });
    await demoA.type(addDialog.getByLabel(/street address/i), STREET);
    await demoA.type(addDialog.getByLabel(/locality/i), "Nürnberg");
    await demoA.type(addDialog.getByLabel(/postal code/i), "90411");
    await demoA.type(addDialog.getByLabel(/region/i), "Bayern");
    // Coordinates come from the address via "Get coordinates" (geocoding), not by
    // hand — the app fills latitude/longitude and toasts "Coordinates filled".
    await demoA.caption("Die Koordinaten holt die App per „Get coordinates“ aus der Adresse.", 2_400);
    await demoA.click(addDialog.getByRole("button", { name: /get coordinates/i }));
    await expect(stageA.getByText("Coordinates filled").first())
      .toBeVisible({ timeout: 60_000 });
    await expect(addDialog.getByLabel(/latitude/i)).not.toHaveValue("", {
      timeout: 10_000,
    });
    await demoA.moveTo(addDialog.getByLabel(/latitude/i));
    await demoA.pause(1_200);
    await demoA.click(addDialog.getByRole("button", { name: /^add building$/i }));
    await expect(addDialog).toBeHidden({ timeout: 60_000 });

    // The new building's Manage row (display name = the street we entered) — its
    // id is used for the Explore payoff deep link and the revoke clip.
    const row = stageA.locator("li[data-building-id]", { hasText: STREET }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    const buildingId = await row.getAttribute("data-building-id");
    if (!buildingId) throw new Error("no data-building-id on the added row");

    // --- Step 3: two years of actual energy + a planned (Soll) value, entered
    //     from the building's Manage row. ---
    await demoA.scene(
      "energy",
      "Schritt 3: Alice erfasst zwei Jahre Verbrauch – und einen Soll-Wert (Plan)",
    );
    await enterEnergyYear(demoA, stageA, row, "2024", "102000", "67000");
    await enterEnergyYear(demoA, stageA, row, "2025", "98000", "64000");
    await demoA.caption("Für 2025 zusätzlich der Plan: Scenario „Planned (Soll)“", 2_600);
    await enterEnergyYear(demoA, stageA, row, "2025", "90000", "60000", /^Planned/);

    // Payoff: plan beside actual in the Explore tab's annual overview.
    await demoA.scene(
      "energy-payoff",
      "Im Explore-Tab zeigt die Jahresübersicht Soll und Ist nebeneinander",
    );
    await stageA.goto(exploreRoute(buildingId));
    await expect(stageA.getByRole("tab", { name: "Building data" }))
      .toBeVisible({ timeout: 60_000 });
    await stageA.waitForLoadState("networkidle").catch(() => {});
    await demoA.pause(1_200);
    await demoA.click(stageA.getByRole("tab", { name: "Energy data" }));
    const planned = stageA.getByText(/\(planned\)/i).first();
    await expect(planned).toBeVisible({ timeout: 60_000 });
    await stageA.waitForLoadState("networkidle").catch(() => {});
    await demoA.moveTo(planned);
    await demoA.caption(
      "Soll und Ist nebeneinander: hält der reale Verbrauch, was der Plan verspricht?",
      3_500,
    );

    // --- Step 4: share the building directly with B by WebID (read-only) —
    //     a WebID is exchanged like an email address; no data room needed. ---
    await demoA.scene(
      "share",
      "Schritt 4: Alice teilt das Gebäude direkt mit B – per WebID, B erhält nur Lesezugriff",
    );
    await stageA.goto("/");
    await demoA.click(stageA.getByRole("tab", { name: "Manage" }));
    await expect(row).toBeVisible({ timeout: 60_000 });
    await demoA.click(row.getByRole("button", { name: "Share building data" }));
    const shareDialog = stageA.getByRole("dialog");
    await expect(shareDialog).toBeVisible({ timeout: 10_000 });
    await demoA.click(shareDialog.getByRole("button", { name: /by webid/i }));
    const recipient = shareDialog.getByLabel(/Recipient WebID/i);
    await demoA.type(recipient, bWebId);
    await recipient.press("Enter");
    await demoA.pause(600);
    await demoA.click(shareDialog.getByRole("button", { name: /review and share/i }));
    const confirm = shareDialog.getByRole("button", { name: /confirm share/i });
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    await demoA.click(confirm);
    await expect(shareDialog.getByText(/shared successfully/i))
      .toBeVisible({ timeout: 120_000 });
    await demoA.pause(1_200);
    await demoA.click(shareDialog.getByRole("button", { name: /done/i }));
    await expect(shareDialog).toBeHidden({ timeout: 10_000 });
    await demoA.caption("");
    await demoA.pause(800);

    const videoA = stageA.video();
    saveMarks("prologue-a", demoA.marks);
    await stageA.close();
    await videoA?.saveAs(`${OUT}/prologue-a.webm`);

    // --- Drain the A→B grant on the DISCARDED setup page first, so B's stage
    //     page's initial buildings fetch (and map fit) already includes A's hall
    //     (cf. vertrieb.spec.ts). ---
    await bSetup.reload();
    await bSetup.getByRole("tab", { name: "Share" }).click();
    await expect(
      bSetup.getByRole("list", { name: /buildings shared with you/i })
        .getByText(/^Building /),
    ).toBeVisible({ timeout: 120_000 });

    // ============ Clip B: B receives the building. ============
    const stageB = await bCtx.newPage();
    const t0b = Date.now();
    await stageB.goto("/");
    await expect(stageB.getByRole("tab", { name: "Share" }))
      .toBeVisible({ timeout: 60_000 });
    await stageB.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageB);
    const demoB = await Demo.install(stageB, "B", t0b);

    // --- B finds A's building under "Shared with you". ---
    await demoB.scene(
      "received",
      "B (Bob Bauer) sieht Alices Gebäude unter „Shared with you“",
    );
    await demoB.click(stageB.getByRole("tab", { name: "Share" }));
    await expect(
      stageB.getByRole("list", { name: /buildings shared with you/i })
        .getByText(/^Building /),
    ).toBeVisible({ timeout: 120_000 });
    await demoB.moveTo(
      stageB.getByRole("list", { name: /buildings shared with you/i }),
    );
    await demoB.pause(2_000);

    // --- On the map: A's shared hall; clicking it reads A's data live. ---
    await demoB.scene(
      "map",
      "Auf der Karte: Alices freigegebene Halle (orange markiert)",
    );
    await demoB.click(stageB.getByRole("tab", { name: "Explore" }));
    const sharedMarker = stageB.locator(".leaflet-marker-icon.pin-shared").first();
    await sharedMarker.waitFor({ timeout: 60_000 });
    await waitForMapTiles(stageB);
    await demoB.pause(1_500);
    await demoB.click(sharedMarker);

    await demoB.scene(
      "payoff",
      "B liest Alices Gebäude- und Energiedaten live aus Alices Pod",
    );
    await expect(stageB.getByRole("tab", { name: "Building data" }))
      .toBeVisible({ timeout: 60_000 });
    await stageB.waitForLoadState("networkidle").catch(() => {});
    await demoB.pause(2_000);
    await demoB.caption("");

    const videoB = stageB.video();
    saveMarks("prologue-b", demoB.marks);
    await stageB.close();
    await videoB?.saveAs(`${OUT}/prologue-b.webm`);
    await bCtx.close();

    // ============ Clip A2: A revokes B's access again. ============
    const stageA2 = await page.context().newPage();
    const t0a2 = Date.now();
    await stageA2.goto("/");
    await expect(stageA2.getByRole("tab", { name: "Manage" }))
      .toBeVisible({ timeout: 60_000 });
    await stageA2.getByRole("tab", { name: "Manage" }).click();
    const row2 = stageA2.locator(`li[data-building-id="${buildingId}"]`).first();
    await expect(row2).toBeVisible({ timeout: 60_000 });
    await stageA2.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageA2);
    const demoA2 = await Demo.install(stageA2, "A", t0a2);

    await demoA2.scene(
      "revoke",
      "Schritt 5: Alice entzieht B den Zugriff – sofort wirksam",
    );
    // After the share, the Manage row carries a "Shared with:" sub-list, each
    // recipient with a "Revoke access" button; a confirm dialog guards it.
    const revoke = row2.getByRole("button", { name: "Revoke access" }).first();
    await expect(revoke).toBeVisible({ timeout: 60_000 });
    await demoA2.click(revoke);
    await demoA2.click(stageA2.getByRole("button", { name: "Revoke", exact: true }));
    await expect(stageA2.getByText("Access revoked").first())
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
    saveMarks("prologue-a2", demoA2.marks);
    await stageA2.close();
    await videoA2?.saveAs(`${OUT}/prologue-a2.webm`);
  });
});

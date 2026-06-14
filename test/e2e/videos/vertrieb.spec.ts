import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { account, hasAccount, login, webIdOf } from "../helpers/login.ts";
import { setDevMode } from "../helpers/accountMenu.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { Demo, type SceneMark } from "./demoPolish.ts";

/**
 * Records the second handbuch video — the Vertriebsoptimierung walkthrough
 * („Vertriebsoptimierung durchgespielt": A shares a building, B sees it) —
 * the actor ladder's first PERSPECTIVE CUT: two clips, one per actor, each
 * recorded on its own staged page (per-page video, see soll-ist.spec.ts for
 * why) and concatenated in post:
 *
 *   deno task videos
 *   bash test/e2e/videos/postprocess.sh vertrieb vertrieb-a vertrieb-b
 *
 * Clip A: Alice shares her hall with Bob by WebID (Share Building Data →
 * By WebID → Review and Share). Clip B: Bob's fresh app load drains the grant,
 * the building shows under "Shared with you", and on the Explore map A's
 * logo-marked hall stands among B's own buildings — read live from A's Pod.
 * B's own surroundings come from the control server's `/seed-actor-buildings`
 * (B is otherwise a fresh pod). LOCAL tier only; artifacts land in
 * `test-results/videos/` and stay uncommitted (hosting is an open decision).
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;
const OUT = "test-results/videos";
const A = account("A");
const B = account("B");
/** A's hall that gets shared (the logistics demo, richest master data). */
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
  await page.getByRole("button", { name: /^close$/i }).first()
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

test.describe("handbuch video: Vertriebsoptimierung", () => {
  test.skip(!E2E_LOCAL, "videos are recorded on the local tier (deno task videos)");
  test.skip(!hasAccount(A) || !hasAccount(B), "local seeded accounts A+B missing");

  test("record", async ({ page, browser }) => {
    test.setTimeout(900_000);
    mkdirSync(OUT, { recursive: true });

    // --- Setup A (fixture page; its video is discarded): login, identities,
    //     demo buildings. ---
    await login(page, A);
    await controlSeed("/seed-profiles");
    await page.reload();
    await expect(page.getByRole("tab", { name: "Connect" }))
      .toBeVisible({ timeout: 60_000 });
    await setDevMode(page, false);
    const addExamples = page.getByRole("button", { name: "Add examples" });
    await expect(addExamples).toBeVisible({ timeout: 60_000 });
    await addExamples.click();
    await expect(page.getByText("Demo buildings and energy data added").first())
      .toBeVisible({ timeout: 300_000 });

    // --- Setup B: own surroundings (seeded out-of-band, before B's first
    //     load), then a logged-in context of B's own. Manual contexts don't
    //     inherit the project's video option — pass recordVideo explicitly. ---
    await controlSeed("/seed-actor-buildings?slot=B&n=2");
    const bCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: `${OUT}/.raw`, size: { width: 1280, height: 720 } },
    });
    const bSetup = await bCtx.newPage();
    await login(bSetup, B); // also self-provisions B's inbox for the grant
    const bWebId = await webIdOf(bSetup);

    // ============ Clip A: Alice shares her hall with Bob. ============
    const stageA = await page.context().newPage();
    const t0a = Date.now();
    await stageA.goto("/");
    await expect(stageA.getByRole("tab", { name: "Manage" }))
      .toBeVisible({ timeout: 60_000 });
    await stageA.getByRole("tab", { name: "Manage" }).click();
    const row = stageA.locator("li", { hasText: BUILDING }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await stageA.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageA);
    const demoA = await Demo.install(stageA, "A", t0a);

    // --- Scene zero: establish the cast and whose problem this solves,
    //     before the resolution starts. ---
    await demoA.intro("Vertriebsoptimierung", [
      {
        slot: "A",
        tagline:
          "Bestandshalterin: Ihre effiziente Halle soll im Marktumfeld sichtbar sein",
      },
      {
        slot: "B",
        tagline:
          "Makler & Berater: Ihm fehlen Energiedaten für einen echten Marktüberblick",
      },
    ]);

    // --- Scene: first contact — a WebID is exchanged like an email address
    //     and remembered once in the address book, which resolves it to a
    //     person (name + picture). ---
    await demoA.scene(
      "contact",
      "B's WebID hat A von ihm selbst – wie eine E-Mail-Adresse. Einmal ins Adressbuch:",
    );
    await demoA.click(stageA.getByRole("tab", { name: "Connect" }));
    const webIdField = stageA.getByRole("textbox", { name: "WebID" });
    await webIdField.waitFor({ state: "visible", timeout: 30_000 });
    await demoA.type(webIdField, bWebId);
    await demoA.click(stageA.getByRole("button", { name: "Add contact" }));
    // The entry resolves to the person: name + avatar, no raw IRI.
    await expect(
      stageA.getByRole("list", { name: "Contacts" }).getByText("Bob Bauer"),
    ).toBeVisible({ timeout: 30_000 });
    await demoA.moveTo(stageA.getByRole("list", { name: "Contacts" }));
    await demoA.pause(2_000);
    await dismissToasts(stageA);

    await demoA.scene(
      "share-open",
      "A teilt ihr Gebäude: das Teilen-Symbol im Manage-Tab",
    );
    await demoA.click(stageA.getByRole("tab", { name: "Manage" }));
    await demoA.click(row.getByRole("button", { name: "Share building data" }));
    const shareDialog = stageA.getByRole("dialog");
    await expect(shareDialog).toBeVisible({ timeout: 10_000 });

    await demoA.scene(
      "share-pick",
      "Als Empfänger schlägt die App B aus dem Adressbuch vor",
    );
    await demoA.click(shareDialog.getByRole("button", { name: /by webid/i }));
    const recipient = shareDialog.getByLabel(/Recipient WebID/i);
    await demoA.click(recipient);
    await demoA.click(stageA.getByRole("option", { name: /Bob Bauer/ }));
    await demoA.pause(600);

    await demoA.scene(
      "share-confirm",
      "Review and Share: B erhält Lesezugriff – die Daten bleiben auf A's Pod",
    );
    await demoA.click(shareDialog.getByRole("button", { name: /review and share/i }));
    const confirm = shareDialog.getByRole("button", { name: /confirm share/i });
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    await demoA.click(confirm);
    await expect(shareDialog.getByText(/shared successfully/i))
      .toBeVisible({ timeout: 120_000 });
    await demoA.pause(1_500);
    await demoA.click(shareDialog.getByRole("button", { name: /done/i }));
    await expect(shareDialog).toBeHidden({ timeout: 10_000 });
    await demoA.caption("");
    await demoA.pause(800);

    const videoA = stageA.video();
    saveMarks("vertrieb-a", demoA.marks);
    await stageA.close();
    await videoA?.saveAs(`${OUT}/vertrieb-a.webm`);

    // ============ Clip B: Bob receives — list, map, live data. ============
    // Drain the grant on the DISCARDED setup page first: the drain runs during
    // a load, AFTER the buildings query already fetched — a stage page that
    // both drains and films would fit the map to B's own buildings only, with
    // A's marker landing outside the fitted bounds (the map never re-fits).
    // Once the grant is archived in shared-in/, the stage page's first
    // buildings fetch includes A's hall and the initial map fit covers it.
    await bSetup.reload();
    await bSetup.getByRole("tab", { name: "Share" }).click();
    await expect(
      bSetup.getByRole("list", { name: /buildings shared with you/i })
        .getByText(/^Building /),
    ).toBeVisible({ timeout: 120_000 });

    const stageB = await bCtx.newPage();
    const t0b = Date.now();
    await stageB.goto("/");
    await expect(stageB.getByRole("tab", { name: "Share" }))
      .toBeVisible({ timeout: 60_000 });
    await stageB.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageB);
    const demoB = await Demo.install(stageB, "B", t0b);

    await demoB.scene(
      "received",
      "B (Bob Bauer) öffnet die App: A's Gebäude liegt unter „Shared with you“",
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

    await demoB.scene(
      "map",
      "Auf der Karte: A's freigegebene Halle (orange markiert) neben B's eigenen Objekten",
    );
    await demoB.click(stageB.getByRole("tab", { name: "Explore" }));
    const sharedMarker = stageB
      .locator(".leaflet-marker-icon.pin-shared").first();
    await sharedMarker.waitFor({ timeout: 60_000 });
    await waitForMapTiles(stageB);
    await demoB.pause(1_500);
    await demoB.click(sharedMarker);

    await demoB.scene(
      "payoff",
      "B liest A's Gebäude- und Energiedaten live aus A's Pod",
    );
    await expect(stageB.getByRole("tab", { name: "Building data" }))
      .toBeVisible({ timeout: 60_000 });
    await stageB.waitForLoadState("networkidle").catch(() => {});
    await demoB.pause(2_000);
    await demoB.caption(
      "Vertriebsoptimierung: Je mehr geteilt wird, desto vollständiger der Marktüberblick",
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

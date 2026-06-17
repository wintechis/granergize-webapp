import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { account, hasAccount, login } from "../helpers/login.ts";
import { de } from "../helpers/i18n.ts";
import { buildingRoute } from "../helpers/manage.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { Demo, type SceneMark } from "./demoPolish.ts";

/**
 * Records the data-room („Datenzimmer") handbuch video — the feature the
 * prolog walkthrough deliberately skips (it shares by direct WebID). Here the
 * room is the subject: a shared space partners join with a role, so data can be
 * shared once to a ROLE instead of to each WebID.
 *
 * The app renders in GERMAN (context locale `de-DE`); every app locator resolves
 * through the message catalog via `de(key)`, so the spec is i18n-driven.
 *
 *   deno task videos
 *   bash test/e2e/videos/postprocess.sh datenzimmer datenzimmer-a datenzimmer-b datenzimmer-a2 datenzimmer-b2
 *
 * Clip A: Alice hosts a Datenzimmer, sets her role and shows the invite link/QR.
 * Clip B: Bob joins via the invite and takes the "Benutzer" role — both are
 * members of the same room. Clip A2: Alice shares a building BY ROLE (to the
 * room's "Benutzer" members) — one share reaches every member with that role.
 * Clip B2: Bob, a Benutzer member, finds the building under "Freigaben". LOCAL
 * tier only; artifacts land in `test-results/videos/` and stay uncommitted.
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;
const OUT = "test-results/videos";
const A = account("A");
const B = account("B");
/** A demo building Alice shares by role (the logistics hall, richest data). */
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

function saveMarks(name: string, marks: SceneMark[]) {
  writeFileSync(`${OUT}/${name}.marks.json`, JSON.stringify(marks, null, 2));
}

/** Open the room's "Meine Rolle(n)" multi-select, show the choices, tick Benutzer, save. */
async function pickUserRole(demo: Demo, stage: Page) {
  const roleSelect = stage.getByRole("combobox", { name: de("roomMyRoles") });
  await demo.click(roleSelect);
  const roleList = stage.getByRole("listbox");
  await expect(roleList).toBeVisible({ timeout: 30_000 });
  await demo.moveTo(roleList);
  await demo.pause(1_600); // let the role catalogue (Investor, Benutzer, …) be read
  await demo.click(stage.getByRole("option", { name: "Benutzer", exact: true }));
  await stage.keyboard.press("Escape");
  await expect(roleList).toBeHidden({ timeout: 10_000 }).catch(() => {});
  await demo.click(stage.getByRole("button", { name: de("saveRoles") }));
  await expect(stage.getByText(de("rolesUpdated")).first())
    .toBeVisible({ timeout: 30_000 });
}

test.describe("handbuch video: Datenzimmer", () => {
  // German UI; clipboard permission so the invite-copy actually writes + toasts.
  test.use({ locale: "de-DE", permissions: ["clipboard-read", "clipboard-write"] });
  test.skip(!E2E_LOCAL, "videos are recorded on the local tier (deno task videos)");
  test.skip(!hasAccount(A) || !hasAccount(B), "local seeded accounts A+B missing");

  test("record", async ({ page, browser }) => {
    test.setTimeout(1_200_000);
    mkdirSync(OUT, { recursive: true });

    // --- Setup A (fixture page; its video is discarded): login, identities, and
    //     demo buildings (Alice needs one to share by role). ---
    await login(page, A);
    await controlSeed("/seed-profiles");
    await page.reload();
    await expect(page.getByRole("tab", { name: de("navBuildings") }))
      .toBeVisible({ timeout: 60_000 });
    // Dev mode defaults OFF in a fresh context — no setDevMode needed (its
    // account-menu locators are English-only, which a de-DE context would miss).
    const addExamples = page.getByRole("button", { name: de("onboardAddExamples") });
    await expect(addExamples).toBeVisible({ timeout: 60_000 });
    await addExamples.click();
    await expect(page.getByText(de("demoBuildingsAdded")).first())
      .toBeVisible({ timeout: 300_000 });

    // --- Setup B: a logged-in context of B's own (German; self-provisions B's
    //     inbox so the role-targeted grant can be delivered). ---
    const bCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      locale: "de-DE",
      recordVideo: { dir: `${OUT}/.raw`, size: { width: 1280, height: 720 } },
    });
    const bSetup = await bCtx.newPage();
    await login(bSetup, B);

    // ============ Clip A: host the Datenzimmer, role, invite. ============
    const stageA = await page.context().newPage();
    const t0a = Date.now();
    await stageA.goto("/");
    await expect(stageA.getByRole("tab", { name: de("navMeet") }))
      .toBeVisible({ timeout: 60_000 });
    await stageA.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageA);
    const demoA = await Demo.install(stageA, "A", t0a);

    await demoA.intro("Das Datenzimmer: einmal teilen, an eine Rolle", [
      {
        slot: "A",
        tagline:
          "Alice Ahlmann: eröffnet ein Datenzimmer und teilt Daten an eine Rolle statt an jede WebID",
      },
      {
        slot: "B",
        tagline: "Partner: tritt dem Datenzimmer bei und erhält so Zugriff",
      },
    ]);

    // --- A hosts the room. ---
    await demoA.scene(
      "host",
      "Schritt 1: Alice eröffnet ein Datenzimmer (Tab „Treffen“)",
    );
    await demoA.click(stageA.getByRole("tab", { name: de("navMeet") }));
    await demoA.click(stageA.getByRole("button", { name: de("roomHostBtn") }));
    await stageA.waitForURL(/\/room\?/, { timeout: 60_000 });
    const roomUri = new URL(stageA.url()).searchParams.get("uri");
    if (!roomUri) throw new Error("hosted room URI missing from the URL");
    await stageA.waitForLoadState("networkidle").catch(() => {});

    // --- A sets her own role. ---
    await demoA.scene(
      "role",
      "Festlegung der eigenen Rolle: Alice wählt im Datenzimmer ihre Rolle(n)",
    );
    await pickUserRole(demoA, stageA);

    // --- A shows the invite link / QR. ---
    await demoA.scene(
      "invite",
      "Über den Einladungslink (QR-Code) lädt Alice Partner ein",
    );
    await demoA.moveTo(stageA.getByText(de("secInvite")).first());
    await demoA.click(stageA.getByRole("button", { name: de("roomCopyInvite") }));
    // The "copied" toast is a nice confirmation but clipboard can still be denied
    // in headless — don't fail the video on it.
    await stageA.getByText(de("inviteCopied")).first()
      .waitFor({ timeout: 8_000 }).catch(() => {});
    await demoA.caption(
      "Diesen Link (oder QR-Code) gibt Alice an B weiter – wie eine Einladung.",
      3_000,
    );

    const videoA = stageA.video();
    saveMarks("datenzimmer-a", demoA.marks);
    await stageA.close();
    await videoA?.saveAs(`${OUT}/datenzimmer-a.webm`);

    // ============ Clip B: Bob joins the room and takes a role. ============
    const stageB = await bCtx.newPage();
    const t0b = Date.now();
    await stageB.goto("/");
    await expect(stageB.getByRole("tab", { name: de("navMeet") }))
      .toBeVisible({ timeout: 60_000 });
    await stageB.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageB);
    const demoB = await Demo.install(stageB, "B", t0b);

    await demoB.scene(
      "join",
      "Schritt 2: B tritt über den Einladungslink bei und wird Mitglied",
    );
    await demoB.click(stageB.getByRole("tab", { name: de("navMeet") }));
    await demoB.type(stageB.getByLabel(de("roomUriLabel")), roomUri);
    await demoB.click(stageB.getByRole("button", { name: de("btnAdd"), exact: true }));
    await demoB.pause(800);
    await stageB.goto(`/room?uri=${encodeURIComponent(roomUri)}`);
    await expect(stageB.getByRole("combobox", { name: de("roomMyRoles") }))
      .toBeVisible({ timeout: 60_000 });

    await demoB.scene(
      "role-b",
      "B legt seine Rolle fest – als „Benutzer“",
    );
    await pickUserRole(demoB, stageB);
    await demoB.caption(
      "B ist jetzt „Benutzer“ im selben Datenzimmer – bereit, Daten zu empfangen.",
      3_000,
    );

    const videoB = stageB.video();
    saveMarks("datenzimmer-b", demoB.marks);
    await stageB.close();
    await videoB?.saveAs(`${OUT}/datenzimmer-b.webm`);

    // ============ Clip A2: Alice shares a building BY ROLE to the room. ============
    const stageA2 = await page.context().newPage();
    const t0a2 = Date.now();
    await stageA2.goto("/");
    await expect(stageA2.getByRole("tab", { name: de("navBuildings") }))
      .toBeVisible({ timeout: 60_000 });
    await stageA2.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageA2);
    const demoA2 = await Demo.install(stageA2, "A", t0a2);

    await demoA2.scene(
      "share-role",
      "Schritt 3: Alice teilt ein Gebäude an die Rolle „Benutzer“ – nicht an einzelne WebIDs",
    );
    await demoA2.click(stageA2.getByRole("tab", { name: de("navBuildings") }));
    await demoA2.click(stageA2.getByRole("button", { name: de("btnList") }));
    const row = stageA2.locator("li[data-building-id]", { hasText: BUILDING }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    const buildingId = await row.getAttribute("data-building-id");
    if (!buildingId) throw new Error("no data-building-id for the demo building");
    await stageA2.goto(buildingRoute("building", buildingId));
    const shareButton = stageA2.getByRole("button", { name: de("btnShare"), exact: true });
    await expect(shareButton).toBeVisible({ timeout: 60_000 });
    await stageA2.waitForLoadState("networkidle").catch(() => {});
    await demoA2.click(shareButton);
    const shareDialog = stageA2.getByRole("dialog");
    await expect(shareDialog).toBeVisible({ timeout: 10_000 });
    await demoA2.click(shareDialog.getByRole("button", { name: de("shareByRole") }));
    await demoA2.click(shareDialog.getByLabel(de("lblRole")));
    await demoA2.click(stageA2.getByRole("option", { name: "Benutzer", exact: true }));
    await demoA2.caption(
      "Empfänger: alle „Benutzer“ im Datenzimmer – heute B, morgen jede:r weitere.",
      2_800,
    );
    await demoA2.click(shareDialog.getByRole("button", { name: de("shareReviewAndShare") }));
    const confirm = shareDialog.getByRole("button", { name: de("shareConfirmShare") });
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    await demoA2.click(confirm);
    // Success = the dialog swaps Confirm for a Done button (the "shared" message
    // itself is a global toast, not in-dialog).
    const shareDone = shareDialog.getByRole("button", { name: de("btnDone") });
    await expect(shareDone).toBeVisible({ timeout: 120_000 });
    await demoA2.pause(1_200);
    await demoA2.click(shareDone);
    await expect(shareDialog).toBeHidden({ timeout: 10_000 });

    const videoA2 = stageA2.video();
    saveMarks("datenzimmer-a2", demoA2.marks);
    await stageA2.close();
    await videoA2?.saveAs(`${OUT}/datenzimmer-a2.webm`);

    // --- Drain the role-targeted grant on the DISCARDED setup page first. ---
    await bSetup.reload();
    await bSetup.getByRole("tab", { name: de("navSharing") }).click();
    await expect(
      bSetup.getByText(new RegExp(`^${de("shareBuildingN", { id: "" }).trim()} `)).first(),
    ).toBeVisible({ timeout: 120_000 });

    // ============ Clip B2: Bob, a Benutzer member, receives the building. ============
    const stageB2 = await bCtx.newPage();
    const t0b2 = Date.now();
    await stageB2.goto("/");
    await expect(stageB2.getByRole("tab", { name: de("navSharing") }))
      .toBeVisible({ timeout: 60_000 });
    await stageB2.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageB2);
    const demoB2 = await Demo.install(stageB2, "B", t0b2);

    const sharedEntry = stageB2
      .getByText(new RegExp(`^${de("shareBuildingN", { id: "" }).trim()} `)).first();
    await demoB2.scene(
      "received",
      "Schritt 4: B (Benutzer-Mitglied) findet Alices Gebäude unter „Freigaben“",
    );
    await demoB2.click(stageB2.getByRole("tab", { name: de("navSharing") }));
    await expect(sharedEntry).toBeVisible({ timeout: 120_000 });
    await demoB2.moveTo(sharedEntry);
    await demoB2.pause(2_000);
    await demoB2.caption(
      "Einmal an die Rolle geteilt – jedes „Benutzer“-Mitglied erhält Zugriff.",
      4_000,
    );
    await demoB2.caption("");
    await demoB2.pause(800);
    await demoB2.outro();

    const videoB2 = stageB2.video();
    saveMarks("datenzimmer-b2", demoB2.marks);
    await stageB2.close();
    await videoB2?.saveAs(`${OUT}/datenzimmer-b2.webm`);
    await bCtx.close();
  });
});

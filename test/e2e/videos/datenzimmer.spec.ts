import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { account, hasAccount, login } from "../helpers/login.ts";
import { setDevMode } from "../helpers/accountMenu.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { Demo, type SceneMark } from "./demoPolish.ts";

/**
 * Records the data-room („Datenzimmer") handbuch video — the feature the
 * prologue walkthrough deliberately skips (it shares by direct WebID). Here the
 * room is the subject: a shared space partners join with a role, so data can be
 * shared once to a ROLE instead of to each WebID. Four actor clips with
 * perspective cuts (cf. vertrieb.spec.ts), concatenated in post:
 *
 *   deno task videos
 *   bash test/e2e/videos/postprocess.sh datenzimmer datenzimmer-a datenzimmer-b datenzimmer-a2 datenzimmer-b2
 *
 * Clip A: Alice hosts a data room, sets her role and shows the invite link/QR.
 * Clip B: Bob joins via the invite and sets his role — both are members of the
 * same room. Clip A2: Alice shares a building BY ROLE (to the room's "User"
 * members) — one share reaches every member with that role. Clip B2: Bob, a
 * User member, finds the building under "Shared with you". LOCAL tier only;
 * artifacts land in `test-results/videos/` and stay uncommitted.
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
  await page.getByRole("button", { name: /^close$/i }).first()
    .click({ timeout: 4_000 }).catch(() => {});
}

function saveMarks(name: string, marks: SceneMark[]) {
  writeFileSync(`${OUT}/${name}.marks.json`, JSON.stringify(marks, null, 2));
}

/** Open the room's "My role(s)" multi-select, show the choices, tick User, save. */
async function pickUserRole(demo: Demo, stage: Page) {
  const roleSelect = stage.getByRole("combobox", { name: "My role(s)" });
  await demo.click(roleSelect);
  const roleList = stage.getByRole("listbox");
  await expect(roleList).toBeVisible({ timeout: 30_000 });
  await demo.moveTo(roleList);
  await demo.pause(1_600); // let the role catalogue (Investor, User, …) be read
  await demo.click(stage.getByRole("option", { name: "User" }));
  await stage.keyboard.press("Escape");
  await expect(roleList).toBeHidden({ timeout: 10_000 }).catch(() => {});
  await demo.click(stage.getByRole("button", { name: /save roles/i }));
  await expect(stage.getByText(/roles updated/i)).toBeVisible({ timeout: 30_000 });
}

test.describe("handbuch video: Datenzimmer", () => {
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
    await expect(page.getByRole("tab", { name: "Connect" }))
      .toBeVisible({ timeout: 60_000 });
    await setDevMode(page, false);
    const addExamples = page.getByRole("button", { name: "Add examples" });
    await expect(addExamples).toBeVisible({ timeout: 60_000 });
    await addExamples.click();
    await expect(page.getByText("Demo buildings and energy data added").first())
      .toBeVisible({ timeout: 300_000 });

    // --- Setup B: a logged-in context of B's own (self-provisions B's inbox so
    //     the role-targeted grant can be delivered). ---
    const bCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: `${OUT}/.raw`, size: { width: 1280, height: 720 } },
    });
    const bSetup = await bCtx.newPage();
    await login(bSetup, B);
    await setDevMode(bSetup, false);

    // ============ Clip A: host the data room, role, invite. ============
    const stageA = await page.context().newPage();
    const t0a = Date.now();
    await stageA.goto("/");
    await expect(stageA.getByRole("tab", { name: "Connect" }))
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
      "Schritt 1: Alice eröffnet ein Datenzimmer (Connect-Tab)",
    );
    await demoA.click(stageA.getByRole("tab", { name: "Connect" }));
    const leave = stageA.getByRole("button", { name: /leave data room/i });
    if (!(await leave.count())) {
      await demoA.click(stageA.getByRole("button", { name: /host a data room/i }));
      await expect(leave).toBeVisible({ timeout: 60_000 });
    }
    const activeRow = stageA.locator("li").filter({ has: leave });
    const activeLink = activeRow.locator('a[href*="/rooms/"]').first();
    await expect(activeLink).toBeVisible({ timeout: 60_000 });
    const roomUri = (await activeLink.getAttribute("href"))?.trim();
    if (!roomUri) throw new Error("hosted room URI missing");

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
    await demoA.moveTo(stageA.getByRole("button", { name: /copy invite link/i }));
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
    await expect(stageB.getByRole("tab", { name: "Connect" }))
      .toBeVisible({ timeout: 60_000 });
    await stageB.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageB);
    const demoB = await Demo.install(stageB, "B", t0b);

    await demoB.scene(
      "join",
      "Schritt 2: B tritt über den Einladungslink bei und wird Mitglied",
    );
    await demoB.click(stageB.getByRole("tab", { name: "Connect" }));
    const joinRow = stageB.locator("li").filter({ hasText: roomUri });
    if (!(await joinRow.count())) {
      await demoB.type(stageB.getByLabel(/data room uri/i), roomUri);
      await demoB.click(stageB.getByRole("button", { name: /^add$/i }));
      await expect(joinRow.first()).toBeVisible({ timeout: 30_000 });
    }
    const enter = joinRow.first().getByRole("button", { name: /enter data room/i });
    if (await enter.count()) await demoB.click(enter);
    await expect(stageB.getByRole("button", { name: /leave data room/i }))
      .toBeVisible({ timeout: 60_000 });

    await demoB.scene(
      "role-b",
      "B legt seine Rolle fest – als „User“",
    );
    await pickUserRole(demoB, stageB);
    await demoB.caption(
      "B ist jetzt „User“ im selben Datenzimmer – bereit, Daten zu empfangen.",
      3_000,
    );

    const videoB = stageB.video();
    saveMarks("datenzimmer-b", demoB.marks);
    await stageB.close();

    // The role-targeted grant lands in B's inbox once A shares (Clip A2). Save
    // B's clip now; the receive happens in Clip B2 after A shares.
    await videoB?.saveAs(`${OUT}/datenzimmer-b.webm`);

    // ============ Clip A2: Alice shares a building BY ROLE to the room. ============
    const stageA2 = await page.context().newPage();
    const t0a2 = Date.now();
    await stageA2.goto("/");
    await expect(stageA2.getByRole("tab", { name: "Manage" }))
      .toBeVisible({ timeout: 60_000 });
    await stageA2.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageA2);
    const demoA2 = await Demo.install(stageA2, "A", t0a2);

    await demoA2.scene(
      "share-role",
      "Schritt 3: Alice teilt ein Gebäude an die Rolle „User“ – nicht an einzelne WebIDs",
    );
    await demoA2.click(stageA2.getByRole("tab", { name: "Manage" }));
    const row = stageA2.locator("li[data-building-id]", { hasText: BUILDING }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await demoA2.click(row.getByRole("button", { name: "Share building data" }));
    const shareDialog = stageA2.getByRole("dialog");
    await expect(shareDialog).toBeVisible({ timeout: 10_000 });
    await demoA2.click(shareDialog.getByRole("button", { name: /by role/i }));
    await demoA2.click(shareDialog.getByLabel("Role"));
    await demoA2.click(stageA2.getByRole("option", { name: "User" }));
    await demoA2.caption(
      "Empfänger: alle „User“ im Datenzimmer – heute B, morgen jede:r weitere.",
      2_800,
    );
    await demoA2.click(shareDialog.getByRole("button", { name: /review and share/i }));
    const confirm = shareDialog.getByRole("button", { name: /confirm share/i });
    await expect(confirm).toBeVisible({ timeout: 30_000 });
    await demoA2.click(confirm);
    await expect(shareDialog.getByText(/shared successfully/i))
      .toBeVisible({ timeout: 120_000 });
    await demoA2.pause(1_200);
    await demoA2.click(shareDialog.getByRole("button", { name: /done/i }));
    await expect(shareDialog).toBeHidden({ timeout: 10_000 });

    const videoA2 = stageA2.video();
    saveMarks("datenzimmer-a2", demoA2.marks);
    await stageA2.close();
    await videoA2?.saveAs(`${OUT}/datenzimmer-a2.webm`);

    // --- Drain the role-targeted grant on the DISCARDED setup page first, so
    //     B's stage page opens with the building already received. ---
    await bSetup.reload();
    await bSetup.getByRole("tab", { name: "Share" }).click();
    await expect(
      bSetup.getByRole("list", { name: /buildings shared with you/i })
        .getByText(/^Building /),
    ).toBeVisible({ timeout: 120_000 });

    // ============ Clip B2: Bob, a User member, receives the building. ============
    const stageB2 = await bCtx.newPage();
    const t0b2 = Date.now();
    await stageB2.goto("/");
    await expect(stageB2.getByRole("tab", { name: "Share" }))
      .toBeVisible({ timeout: 60_000 });
    await stageB2.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageB2);
    const demoB2 = await Demo.install(stageB2, "B", t0b2);

    await demoB2.scene(
      "received",
      "Schritt 4: B (User-Mitglied) findet Alices Gebäude unter „Shared with you“",
    );
    await demoB2.click(stageB2.getByRole("tab", { name: "Share" }));
    await expect(
      stageB2.getByRole("list", { name: /buildings shared with you/i })
        .getByText(/^Building /),
    ).toBeVisible({ timeout: 120_000 });
    await demoB2.moveTo(
      stageB2.getByRole("list", { name: /buildings shared with you/i }),
    );
    await demoB2.pause(2_000);
    await demoB2.caption(
      "Einmal an die Rolle geteilt – jedes „User“-Mitglied erhält Zugriff.",
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

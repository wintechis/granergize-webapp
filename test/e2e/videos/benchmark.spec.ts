import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { account, hasAccount, login, webIdOf } from "../helpers/login.ts";
import { buildingRoute, receivedViews } from "../helpers/manage.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { Demo, type SceneMark } from "./demoPolish.ts";

/**
 * Records the third handbuch video — the Energieverbrauchsbenchmark
 * walkthrough („Energieverbrauchsbenchmark durchgespielt": peer-benchmarking
 * with a benchmark service provider) — the actor ladder's top rung, three
 * clips cut by perspective:
 *
 *   deno task handbuch:videos
 *   bash test/e2e/videos/postprocess.sh benchmark benchmark-a benchmark-c benchmark-payoff
 *
 * Clip A: Alice shares her hall — energy included — to C (Conrad Kennwert);
 * B contributes the same way OFF camera (the step is identical to clip A, and
 * the walkthrough says so). Clip C: the provider finds both contributions
 * under "Shared with you", builds a "Compare shared buildings" view over
 * them, and shares the result back via "Add all contributors". Clip payoff:
 * back at A, the received view sits under "Views shared with you" and the
 * energy detail page's Benchmark column is filled, naming C. The UI flow
 * mirrors the proven peer-benchmark.spec.ts roundtrip. LOCAL tier only;
 * artifacts land in `test-results/videos/`, uncommitted (hosting is open).
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;
const OUT = "test-results/videos";
const A = account("A");
const B = account("B");
const C = account("C");
/** A's hall that contributes to (and is judged against) the benchmark. */
const BUILDING = "Nordostpark";
const VIEW_NAME = "Energie-Benchmark";

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

/** Share a building to `webId` without demo pacing (the off-camera B share). */
async function shareFirstBuildingTo(page: Page, webId: string) {
  await page.getByRole("tab", { name: "Manage" }).click();
  const row = page.locator("li[data-building-id]").first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole("button", { name: "Share building data" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: /by webid/i }).click();
  const recipient = dlg.getByLabel(/Recipient WebID/i);
  await recipient.fill(webId);
  await recipient.press("Enter");
  const confirm = dlg.getByRole("button", { name: /confirm share/i });
  await expect(async () => {
    await dlg.getByRole("button", { name: /review & share/i }).click();
    await expect(confirm).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
  await confirm.click();
  await expect(dlg.getByText(/shared successfully/i))
    .toBeVisible({ timeout: 120_000 });
  await dlg.getByRole("button", { name: /done/i }).click();
  await expect(dlg).toBeHidden({ timeout: 10_000 });
}

test.describe("handbuch video: Energieverbrauchsbenchmark", () => {
  test.skip(!E2E_LOCAL, "videos are recorded on the local tier (deno task handbuch:videos)");
  test.skip(
    !hasAccount(A) || !hasAccount(B) || !hasAccount(C),
    "local seeded accounts A+B+C missing",
  );

  test("record", async ({ page, browser }) => {
    test.setTimeout(900_000);
    mkdirSync(OUT, { recursive: true });

    // --- Setup A (fixture page; video discarded): login, identities, demo
    //     buildings. ---
    await login(page, A);
    await controlSeed("/seed-profiles");
    await page.reload();
    await expect(page.getByRole("tab", { name: "Connect" }))
      .toBeVisible({ timeout: 60_000 });
    await page.getByRole("checkbox", { name: "Developer mode" }).uncheck();
    const addExamples = page.getByRole("button", { name: "Add examples" });
    await expect(addExamples).toBeVisible({ timeout: 60_000 });
    await addExamples.click();
    await expect(page.getByText("Demo buildings added").first())
      .toBeVisible({ timeout: 300_000 });
    await page.getByRole("tab", { name: "Manage" }).click();
    const aRow = page.locator("li", { hasText: BUILDING }).first();
    await expect(aRow).toBeVisible({ timeout: 60_000 });
    const buildingId = await aRow.getAttribute("data-building-id");

    // --- Setup C: the provider's own recorded context; logging in also
    //     self-provisions C's inbox, which A's and B's grants land in. ---
    const cCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: `${OUT}/.raw`, size: { width: 1280, height: 720 } },
    });
    const cSetup = await cCtx.newPage();
    await login(cSetup, C);
    const cWebId = await webIdOf(cSetup);
    await cSetup.waitForLoadState("networkidle").catch(() => {});

    // --- Setup B (never filmed, plain context): own buildings with energy,
    //     one shared to C — the walkthrough's "B teilt ebenso". ---
    await controlSeed("/seed-actor-buildings?slot=B&n=2");
    const bCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    const bPage = await bCtx.newPage();
    await login(bPage, B);
    await shareFirstBuildingTo(bPage, cWebId);
    await bCtx.close();

    // C into A's address book OFF camera (the walkthrough story: the
    // provider's WebID arrived with the engagement; the contact-add moment
    // itself is established once, in the Vertriebsoptimierung video). The
    // share dialog then offers "Charlie Conrad" as a suggestion on camera.
    await page.getByRole("tab", { name: "Connect" }).click();
    const webIdField = page.getByRole("textbox", { name: "WebID" });
    await webIdField.waitFor({ state: "visible", timeout: 30_000 });
    await webIdField.fill(cWebId);
    await page.getByRole("button", { name: "Add contact" }).click();
    await expect(
      page.getByRole("list", { name: "Contacts" }).getByText("Charlie Conrad"),
    ).toBeVisible({ timeout: 30_000 });

    // ============ Clip A: Alice contributes her hall. ============
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
    await demoA.intro("Energieverbrauchsbenchmark", [
      {
        slot: "A",
        tagline: "Bestandshalterin: Wo steht ihre Halle im Branchenvergleich?",
      },
      {
        slot: "B",
        tagline:
          "Bestandshalter: Will denselben Vergleich – ohne A seine Zahlen zu zeigen",
      },
      {
        slot: "C",
        tagline:
          "Benchmark-Dienstleister: Berechnet den Branchenwert aus geteilten Gebäuden",
      },
    ]);
    await demoA.scene(
      "share-energy",
      "A teilt ihr Gebäude an C – einschließlich der Energiedaten. C's WebID liegt aus der Beauftragung im Adressbuch",
    );
    await demoA.click(row.getByRole("button", { name: "Share building data" }));
    const shareDialog = stageA.getByRole("dialog");
    await expect(shareDialog).toBeVisible({ timeout: 10_000 });
    await demoA.click(shareDialog.getByRole("button", { name: /by webid/i }));
    const recipient = shareDialog.getByLabel(/Recipient WebID/i);
    await demoA.click(recipient);
    await demoA.click(stageA.getByRole("option", { name: /Charlie Conrad/ }));
    await demoA.moveTo(
      shareDialog.getByRole("radio", { name: /all energy readings/i }),
    );
    await demoA.pause(1_200);
    await demoA.click(shareDialog.getByRole("button", { name: /review & share/i }));
    const confirmA = shareDialog.getByRole("button", { name: /confirm share/i });
    await expect(confirmA).toBeVisible({ timeout: 30_000 });
    await demoA.click(confirmA);
    await expect(shareDialog.getByText(/shared successfully/i))
      .toBeVisible({ timeout: 120_000 });
    await demoA.click(shareDialog.getByRole("button", { name: /done/i }));
    await expect(shareDialog).toBeHidden({ timeout: 10_000 });
    await demoA.caption(
      "B teilt sein Gebäude ebenso – A und B sehen dabei gegenseitig keine Daten",
      3_500,
    );
    await demoA.caption("");
    await demoA.pause(800);

    const videoA = stageA.video();
    saveMarks("benchmark-a", demoA.marks);
    await stageA.close();
    await videoA?.saveAs(`${OUT}/benchmark-a.webm`);

    // ============ Clip C: the provider computes and shares back. ============
    // Drain both grants on the DISCARDED setup page first (see vertrieb.spec.ts:
    // a stage page that drains while filming misses the fold).
    await cSetup.reload();
    await cSetup.getByRole("tab", { name: "Share" }).click();
    await expect(async () => {
      const n = await cSetup
        .getByRole("list", { name: /buildings shared with you/i })
        .getByText(/^Building /).count();
      expect(n).toBe(2);
    }).toPass({ timeout: 120_000 });

    const stageC = await cCtx.newPage();
    const t0c = Date.now();
    await stageC.goto("/");
    await expect(stageC.getByRole("tab", { name: "Share" }))
      .toBeVisible({ timeout: 60_000 });
    await stageC.waitForLoadState("networkidle").catch(() => {});
    // C owns no buildings — wave off the fresh-Pod onboarding banner off-scene.
    await stageC.getByRole("button", { name: "No thanks" })
      .click({ timeout: 4_000 }).catch(() => {});
    await dismissToasts(stageC);
    const demoC = await Demo.install(stageC, "C", t0c);

    await demoC.scene(
      "received",
      "Bei C: Die Beiträge von A und B erscheinen unter „Shared with you“",
    );
    await demoC.click(stageC.getByRole("tab", { name: "Share" }));
    await expect(
      stageC.getByRole("list", { name: /buildings shared with you/i })
        .getByText(/^Building /).first(),
    ).toBeVisible({ timeout: 60_000 });
    await demoC.moveTo(
      stageC.getByRole("list", { name: /buildings shared with you/i }),
    );
    await demoC.pause(2_000);

    await demoC.scene(
      "create-view",
      "C erstellt eine Ansicht der Art „Compare shared buildings“ über die geteilten Gebäude",
    );
    await demoC.click(stageC.getByRole("tab", { name: "Manage" }));
    await demoC.click(stageC.getByRole("button", { name: /create view/i }));
    const dlg = stageC.getByRole("dialog");
    await expect(dlg).toBeVisible({ timeout: 10_000 });
    // The shared-with-me roster folds in asynchronously; retry the select
    // until the benchmark mode is offered (mirrors peer-benchmark.spec.ts).
    const modeSel = dlg.getByLabel("View type");
    await expect(async () => {
      await modeSel.click();
      const opt = stageC.getByRole("option", { name: /compare shared buildings/i });
      try {
        await expect(opt).toBeVisible({ timeout: 5_000 });
        await opt.click();
      } catch (e) {
        await stageC.keyboard.press("Escape").catch(() => {});
        throw e;
      }
    }).toPass({ timeout: 60_000 });
    await demoC.type(dlg.getByLabel("View Name"), VIEW_NAME);
    await demoC.click(dlg.getByLabel("Select Buildings"));
    const options = stageC.getByRole("option");
    await expect(async () => {
      expect(await options.count()).toBe(2);
    }).toPass({ timeout: 60_000 });
    await demoC.click(options.nth(0));
    await demoC.click(options.nth(1));
    await stageC.keyboard.press("Escape");
    await demoC.pause(600);
    await demoC.click(dlg.getByRole("button", { name: /create view/i }));
    await expect(stageC.getByText(/view created successfully/i))
      .toBeVisible({ timeout: 60_000 });
    await dismissToasts(stageC);

    await demoC.scene(
      "share-back",
      "C teilt das Ergebnis an alle Beitragenden zurück: „Add all contributors“ – ein Klick",
    );
    const viewRow = stageC.locator("li").filter({ hasText: VIEW_NAME }).first();
    await expect(viewRow).toBeVisible({ timeout: 30_000 });
    await demoC.click(viewRow.getByRole("button", { name: "Share view" }));
    const shareDlg = stageC.getByRole("dialog");
    const addAll = shareDlg.getByRole("button", { name: /add all .* contributors/i });
    await expect(addAll).toBeEnabled({ timeout: 60_000 });
    await demoC.click(addAll);
    await demoC.pause(1_200);
    const confirmC = shareDlg.getByRole("button", { name: /confirm share/i });
    await expect(async () => {
      await shareDlg.getByRole("button", { name: /review & share/i }).click();
      await expect(confirmC).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    await demoC.click(confirmC);
    await expect(shareDlg.getByText(/shared successfully/i))
      .toBeVisible({ timeout: 120_000 });
    await demoC.click(shareDlg.getByRole("button", { name: /close/i }));
    await demoC.caption(
      "Nur der berechnete Snapshot wandert zurück – nicht die Gebäude der Beitragenden",
      3_500,
    );
    await demoC.caption("");
    await demoC.pause(800);

    const videoC = stageC.video();
    saveMarks("benchmark-c", demoC.marks);
    await stageC.close();
    await videoC?.saveAs(`${OUT}/benchmark-c.webm`);
    await cCtx.close();

    // ============ Clip payoff: back at A. ============
    // Drain C's share-back on the discarded fixture page first.
    await page.reload();
    await page.getByRole("tab", { name: "Share" }).click();
    await expect(receivedViews(page).getByText(VIEW_NAME))
      .toBeVisible({ timeout: 120_000 });

    const stageA2 = await page.context().newPage();
    const t0p = Date.now();
    await stageA2.goto("/");
    await expect(stageA2.getByRole("tab", { name: "Share" }))
      .toBeVisible({ timeout: 60_000 });
    await stageA2.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageA2);
    const demoP = await Demo.install(stageA2, "A", t0p);

    await demoP.scene(
      "returned",
      "Zurück bei A: Die Ansicht von C liegt unter „Views shared with you“",
    );
    await demoP.click(stageA2.getByRole("tab", { name: "Share" }));
    await expect(receivedViews(stageA2).getByText(VIEW_NAME))
      .toBeVisible({ timeout: 60_000 });
    await demoP.moveTo(receivedViews(stageA2).getByText(VIEW_NAME));
    await demoP.pause(2_000);

    await demoP.scene(
      "benchmark-column",
      "Auf der Energie-Detailseite füllt sich die Spalte „Benchmark“ – mit dem Branchenwert von C",
    );
    await stageA2.goto(buildingRoute("energy", buildingId));
    await expect(
      stageA2.getByRole("columnheader", { name: /benchmark kwh/i }).first(),
    ).toBeVisible({ timeout: 60_000 });
    // The provider caption proves the benchmark arrived, but it sits at the
    // page bottom — moving there would frame the (empty) trailing sections.
    // The visual payoff is the FIRST consumption table's filled Benchmark
    // column, near the top.
    await expect(stageA2.getByText(/benchmark provided by/i))
      .toBeVisible({ timeout: 60_000 });
    await stageA2.waitForLoadState("networkidle").catch(() => {});
    await demoP.pause(1_500); // let the page read before the cursor moves
    await demoP.moveTo(
      stageA2.locator("table").filter({
        has: stageA2.locator("th", { hasText: "Benchmark kWh / a" }),
      }).first(),
    );
    await demoP.pause(2_500);
    await demoP.caption(
      "Der eigene Verbrauch im Branchenvergleich – ohne dass A und B einander Gebäude offenlegen",
      4_000,
    );
    await demoP.caption("");
    await demoP.pause(800);
    await demoP.outro();

    const videoP = stageA2.video();
    saveMarks("benchmark-payoff", demoP.marks);
    await stageA2.close();
    await videoP?.saveAs(`${OUT}/benchmark-payoff.webm`);
  });
});

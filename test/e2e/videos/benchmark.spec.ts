import { expect, type Page, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { account, hasAccount, login, webIdOf } from "../helpers/login.ts";
import { buildingRoute } from "../helpers/manage.ts";
import { ADD_CONTRIBUTORS, VID_LANG, VID_LOCALE, VID_OUT, vt } from "./lang.ts";
import { importExampleBuildings } from "../helpers/seed.ts";
import { LOCAL_CSS_CONTROL_PORT } from "../../config/localSeed.ts";
import { Demo, type SceneMark } from "./demoPolish.ts";

/**
 * Records the third handbuch video — the Energieverbrauchsbenchmark walkthrough
 * (peer-benchmarking with a benchmark service provider) — three clips cut by
 * perspective:
 *
 *   deno task videos
 *   bash test/e2e/videos/postprocess.sh benchmark benchmark-a benchmark-c benchmark-payoff
 *
 * The app renders in GERMAN (context locale `de-DE`); every app locator resolves
 * through the message catalog via `vt(key)` (i18n-driven).
 *
 * Clip A: Alice shares her hall — energy included — to C (Conrad Kennwert); B
 * contributes the same way OFF camera. Clip C: the provider finds both
 * contributions under "Freigaben", builds a "Geteilte Gebäude vergleichen" view
 * over them, and shares the result back via "Alle Beitragenden hinzufügen". Clip
 * payoff: back at A, the received aggregation sits under "Mit dir geteilte
 * Aggregationen" and the energy detail page's Benchmark row is filled. LOCAL
 * tier only; artifacts land in `test-results/videos/`, uncommitted.
 */

const ENV = (globalThis as { process?: { env: Record<string, string | undefined> } })
  .process?.env;
const E2E_LOCAL = !!ENV?.E2E_LOCAL;
const OUT = VID_OUT;
const A = account("A");
const B = account("B");
const C = account("C");
/** A's hall that contributes to (and is judged against) the benchmark. */
const BUILDING = "Thomas-Dachser-Str.";
const VIEW_NAME = "Energie-Benchmark";
/** The "Gebäude <id>" prefix the shared-with-you list shows for a received building. */
const SHARED_PREFIX = new RegExp(`^${vt("shareBuildingN", { id: "" }).trim()} `);
/** Received aggregations now live in the Aggregations finder (Shared tier), in its
 * list (aria-label = the finder heading) — the standalone "Aggregations shared with
 * you" list moved off the Sharing tab (finder-collection-model Slice 5). */
const receivedAggs = (page: Page) =>
  page.getByRole("list", { name: vt("navAggregations") });

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

/** Share a building to `webId` without demo pacing (the off-camera B share). */
async function shareFirstBuildingTo(page: Page, webId: string) {
  await page.getByRole("tab", { name: vt("navBuildings") }).click();
  await page.getByRole("button", { name: vt("btnList") }).click();
  const row = page.locator("li[data-building-id]").first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  const id = await row.getAttribute("data-building-id");
  await page.goto(buildingRoute("building", id));
  await page.getByRole("button", { name: vt("btnShare"), exact: true }).click();
  const dlg = page.getByRole("dialog");
  const recipient = dlg.getByLabel(vt("racLabel"));
  await recipient.fill(webId);
  await recipient.press("Enter");
  const confirm = dlg.getByRole("button", { name: vt("shareConfirmShare") });
  await expect(async () => {
    await dlg.getByRole("button", { name: vt("shareReviewAndShare") }).click();
    await expect(confirm).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 90_000 });
  await confirm.click();
  const done = dlg.getByRole("button", { name: vt("btnDone") });
  await expect(done).toBeVisible({ timeout: 120_000 });
  await done.click();
  await expect(dlg).toBeHidden({ timeout: 10_000 });
}

test.describe("handbuch video: Energieverbrauchsbenchmark", () => {
  test.use({ locale: VID_LOCALE }); // render the app in German
  test.skip(!E2E_LOCAL, "videos are recorded on the local tier (deno task videos)");
  test.skip(
    !hasAccount(A) || !hasAccount(B) || !hasAccount(C),
    "local seeded accounts A+B+C missing",
  );

  test("record", async ({ page, browser }) => {
    test.setTimeout(900_000);
    mkdirSync(OUT, { recursive: true });

    // --- Setup A (fixture page; video discarded): login, identities, demo
    //     buildings. (Dev mode defaults OFF in a fresh context.) ---
    await login(page, A);
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
    const aRow = page.locator("li", { hasText: BUILDING }).first();
    await expect(aRow).toBeVisible({ timeout: 60_000 });
    const buildingId = await aRow.getAttribute("data-building-id");

    // --- Setup C: the provider's own recorded context (German). ---
    const cCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      locale: VID_LOCALE,
      recordVideo: { dir: `${OUT}/.raw`, size: { width: 1280, height: 720 } },
    });
    const cSetup = await cCtx.newPage();
    await login(cSetup, C);
    const cWebId = await webIdOf(cSetup);
    await cSetup.waitForLoadState("networkidle").catch(() => {});

    // --- Setup B (never filmed, German context): own buildings with energy,
    //     one shared to C — the walkthrough's "B teilt ebenso". ---
    await controlSeed("/seed-actor-buildings?slot=B&n=2");
    const bCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      locale: VID_LOCALE,
    });
    const bPage = await bCtx.newPage();
    await login(bPage, B);
    await shareFirstBuildingTo(bPage, cWebId);
    await bCtx.close();

    // C into A's address book OFF camera (the share dialog then offers
    // "Charlie Conrad" as a suggestion on camera).
    await page.getByRole("tab", { name: vt("navAgents") }).click();
    const webIdField = page.getByRole("textbox", { name: "WebID" });
    await webIdField.waitFor({ state: "visible", timeout: 30_000 });
    await webIdField.fill(cWebId);
    await page.getByRole("button", { name: vt("agentAddAria") }).click();
    await expect(
      page.getByRole("list", { name: vt("navAgents") }).getByText("Charlie Conrad"),
    ).toBeVisible({ timeout: 30_000 });

    // ============ Clip A: Alice contributes her hall. ============
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
    await demoA.click(row.locator('a[href*="/building?"]').first());
    const shareButton = stageA.getByRole("button", { name: vt("btnShare"), exact: true });
    await expect(shareButton).toBeVisible({ timeout: 60_000 });
    await stageA.waitForLoadState("networkidle").catch(() => {});
    await demoA.pause(1_000);
    await demoA.click(shareButton);
    const shareDialog = stageA.getByRole("dialog");
    await expect(shareDialog).toBeVisible({ timeout: 10_000 });
    const recipient = shareDialog.getByLabel(vt("racLabel"));
    await demoA.click(recipient);
    await demoA.click(stageA.getByRole("option", { name: /Charlie Conrad/ }));
    await demoA.moveTo(
      shareDialog.getByRole("radio", { name: vt("shareScopeAll") }),
    );
    await demoA.pause(1_200);
    await demoA.click(shareDialog.getByRole("button", { name: vt("shareReviewAndShare") }));
    const confirmA = shareDialog.getByRole("button", { name: vt("shareConfirmShare") });
    await expect(confirmA).toBeVisible({ timeout: 30_000 });
    await demoA.click(confirmA);
    const shareDoneA = shareDialog.getByRole("button", { name: vt("btnDone") });
    await expect(shareDoneA).toBeVisible({ timeout: 120_000 });
    await demoA.click(shareDoneA);
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
    // Drain both grants on the DISCARDED setup page first.
    await cSetup.reload();
    await cSetup.getByRole("tab", { name: vt("navSharing") }).click();
    await expect(async () => {
      const n = await cSetup.getByText(SHARED_PREFIX).count();
      expect(n).toBe(2);
    }).toPass({ timeout: 120_000 });

    const stageC = await cCtx.newPage();
    const t0c = Date.now();
    await stageC.goto("/");
    await expect(stageC.getByRole("tab", { name: vt("navSharing") }))
      .toBeVisible({ timeout: 60_000 });
    await stageC.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageC);
    const demoC = await Demo.install(stageC, "C", t0c);

    await demoC.scene(
      "received",
      "Bei C: Die Beiträge von A und B erscheinen unter „Freigaben“",
    );
    await demoC.click(stageC.getByRole("tab", { name: vt("navSharing") }));
    await expect(stageC.getByText(SHARED_PREFIX).first())
      .toBeVisible({ timeout: 60_000 });
    await demoC.moveTo(stageC.getByText(SHARED_PREFIX).first());
    await demoC.pause(2_000);

    await demoC.scene(
      "create-view",
      "C erstellt eine Ansicht der Art „Geteilte Gebäude vergleichen“ über die geteilten Gebäude",
    );
    await demoC.click(stageC.getByRole("tab", { name: vt("navAggregations") }));
    await demoC.click(stageC.getByRole("button", { name: vt("aggCreateTitle") }));
    const dlg = stageC.getByRole("dialog");
    await expect(dlg).toBeVisible({ timeout: 10_000 });
    // The shared-with-me roster folds in asynchronously; retry the select until
    // the benchmark mode is offered (mirrors peer-benchmark.spec.ts).
    const modeSel = dlg.getByLabel(vt("aggTypeLabel"));
    await expect(async () => {
      await modeSel.click();
      const opt = stageC.getByRole("option", { name: vt("aggModeBenchmark") });
      try {
        await expect(opt).toBeVisible({ timeout: 5_000 });
        await opt.click();
      } catch (e) {
        await stageC.keyboard.press("Escape").catch(() => {});
        throw e;
      }
    }).toPass({ timeout: 60_000 });
    await demoC.type(dlg.getByLabel(vt("aggNameLabel")), VIEW_NAME);
    await demoC.click(dlg.getByLabel(vt("aggSelectBuildings")));
    const options = stageC.getByRole("option");
    await expect(async () => {
      expect(await options.count()).toBe(2);
    }).toPass({ timeout: 60_000 });
    await demoC.click(options.nth(0));
    await demoC.click(options.nth(1));
    await stageC.keyboard.press("Escape");
    await demoC.pause(600);
    await demoC.click(dlg.getByRole("button", { name: vt("aggCreateTitle") }));
    // Create computes the snapshot synchronously — wait for the dialog to CLOSE,
    // not the success toast (the single FIFO snackbar buries it).
    await expect(dlg).toBeHidden({ timeout: 120_000 });
    await dismissToasts(stageC);

    await demoC.scene(
      "share-back",
      "C teilt das Ergebnis an alle Beitragenden zurück: „Alle Beitragenden hinzufügen“ – ein Klick",
    );
    const aggregationRow = stageC.locator("li").filter({ hasText: VIEW_NAME }).first();
    await expect(aggregationRow).toBeVisible({ timeout: 30_000 });
    await demoC.click(aggregationRow.getByRole("button", { name: vt("aggShareAria") }));
    const shareDlg = stageC.getByRole("dialog");
    const addAll = shareDlg.getByRole("button", { name: ADD_CONTRIBUTORS });
    await expect(addAll).toBeEnabled({ timeout: 60_000 });
    await demoC.click(addAll);
    await demoC.pause(1_200);
    const confirmC = shareDlg.getByRole("button", { name: vt("shareConfirmShare") });
    await expect(async () => {
      await shareDlg.getByRole("button", { name: vt("shareReviewAndShare") }).click();
      await expect(confirmC).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 60_000 });
    await demoC.click(confirmC);
    // The aggregation dialog renders its success in-dialog ("Erfolgreich geteilt
    // mit …") and keeps a Close button.
    await expect(shareDlg.getByText(vt("shareSuccessWith")))
      .toBeVisible({ timeout: 120_000 });
    await demoC.click(shareDlg.getByRole("button", { name: vt("btnClose"), exact: true }));
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
    await page.reload();
    await page.getByRole("tab", { name: vt("navAggregations") }).click();
    await expect(receivedAggs(page).getByText(VIEW_NAME))
      .toBeVisible({ timeout: 120_000 });

    const stageA2 = await page.context().newPage();
    const t0p = Date.now();
    await stageA2.goto("/");
    await expect(stageA2.getByRole("tab", { name: vt("navAggregations") }))
      .toBeVisible({ timeout: 60_000 });
    await stageA2.waitForLoadState("networkidle").catch(() => {});
    await dismissToasts(stageA2);
    const demoP = await Demo.install(stageA2, "A", t0p);

    await demoP.scene(
      "returned",
      "Zurück bei A: Die Ansicht von C liegt im Aggregationen-Finder unter „Mit mir geteilt“",
    );
    await demoP.click(stageA2.getByRole("tab", { name: vt("navAggregations") }));
    await expect(receivedAggs(stageA2).getByText(VIEW_NAME))
      .toBeVisible({ timeout: 60_000 });
    await demoP.moveTo(receivedAggs(stageA2).getByText(VIEW_NAME));
    await demoP.pause(2_000);

    await demoP.scene(
      "benchmark-column",
      "Auf der Energie-Detailseite füllt sich die Zeile „Benchmark“ – mit dem Branchenwert von C",
    );
    await stageA2.goto(buildingRoute("observation", buildingId));
    // The benchmark was shared back AFTER this page first loaded for A2 — reload so
    // the energy page refetches and the received benchmark fills its column.
    await stageA2.reload();
    await stageA2.waitForLoadState("networkidle").catch(() => {});
    await expect(
      stageA2.getByRole("row").filter({ hasText: vt("aeBenchmark") }).first(),
    ).toBeVisible({ timeout: 60_000 });
    // The "Benchmark provided by" attribution proves the benchmark arrived — it is
    // a catalog message now, so match it in the video's language.
    await expect(stageA2.getByText(vt("aeBenchmarkProvidedBy")).first())
      .toBeVisible({ timeout: 60_000 });
    await stageA2.waitForLoadState("networkidle").catch(() => {});
    await demoP.pause(1_500);
    await demoP.moveTo(
      stageA2.locator("table").filter({
        has: stageA2.getByRole("row").filter({ hasText: vt("aeBenchmark") }),
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

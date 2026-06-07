import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";
import { newCapturedPage } from "../helpers/consoleLog.ts";
import { ensureDemoBuildings } from "../helpers/seed.ts";
import { verifyAndReset } from "../helpers/cleanSlate.ts";

/**
 * Building-details e2e (single account, a throwaway solo Pod). Covers two user
 * tasks on a building's detail views:
 *   1. Viewing a building shows its linked operator as a resolvable WebID link —
 *      the detail panel renders IRIs as clickable links that open the WebID
 *      itself (the education-mandate "IRIs are dereferenceable" behaviour).
 *   2. The energy view benchmarks a building's consumption against the operator
 *      average — the table shows the building's own figures beside an
 *      "Operator Average kWh / a" column.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/building-details.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/building-details.spec.ts
 *
 * Runs against Alice (account A). Self-cleaning: deletes the
 * building it adds. Skipped automatically when account env vars are absent.
 */

const OP_STREET = "Building Details E2E Strasse 1"; // unique throwaway address
const OP_WEBID = "https://e2e.example.org/profile/card#me"; // a WebID (with #fragment)
const OP_HASH = "me"; // the detail link shows the IRI's #fragment as its text

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("building details", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the building-details e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000); // login (IdP + consent) can be slow / retried
    page = await newCapturedPage(browser, "building-details");
    page.on("dialog", (d) => d.accept().catch(() => {})); // "Delete building" confirm
    await login(page, ACC);
    await ensureDemoBuildings(page); // for the energy-benchmark task
  });

  test.afterAll(async () => {
    await verifyAndReset(page, "building-details");
    await page.close();
  });

  test("a building's operator shows as a link to its WebID", async () => {
    test.setTimeout(180_000);

    // --- add a building whose operator is a WebID (User template) ---
    await page.getByRole("tab", { name: "Manage" }).click();
    const addBtn = page.getByRole("button", { name: "Add Building", exact: true })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 120_000 });
    await addBtn.click();
    const add = page.getByRole("dialog");
    await add.getByLabel("Template").click();
    await page.getByRole("option", { name: "User", exact: true }).click();
    await add.getByLabel(/street address/i).fill(OP_STREET);
    await add.getByLabel(/locality/i).fill("Nürnberg");
    await add.getByLabel(/postal code/i).fill("90451");
    await add.getByLabel(/region/i).fill("Bayern");
    await add.getByLabel(/latitude/i).fill("49.45");
    await add.getByLabel(/longitude/i).fill("11.08");
    await add.getByLabel(/operated by/i).fill(OP_WEBID);
    await add.getByRole("button", { name: /^Add Building$/ }).click();
    await expect(page.getByText(/building added/i)).toBeVisible({
      timeout: 120_000,
    });

    // --- resolve its numeric id from the Manage row ("Building <id> — …") ---
    const row = page.locator("li", { hasText: OP_STREET }).first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    const id = (await row.textContent())?.match(/Building (\S+)/)?.[1];
    expect(id, "the new building's id on Manage").toBeTruthy();

    // --- view the building: the operator renders as a link to its WebID ---
    await page.goto(`/#/building/${id}`);
    const opLink = page.locator(`a[href="${OP_WEBID}"]`);
    await expect(opLink).toBeVisible({ timeout: 60_000 });
    await expect(opLink).toHaveText(OP_HASH); // shows the IRI's #fragment
    await expect(opLink).toHaveAttribute("target", "_blank"); // opens the WebID itself

    // --- self-clean: delete the throwaway building ---
    await page.goto("/#/");
    await page.getByRole("tab", { name: "Manage" }).click();
    const back = page.locator("li", { hasText: OP_STREET }).first();
    await expect(back).toBeVisible({ timeout: 60_000 });
    await back.getByRole("button", { name: "Delete building" }).click();
    await expect(page.getByText("Building deleted").first()).toBeVisible({
      timeout: 90_000,
    });

    // NOTE: customer/investor render through the same link path but have no UI
    // input; cover them by importing a generic CSV that carries those columns
    // (parseCsvToFields in buildingSerializer.ts) and repeating the assertion.
  });

  test("the energy view benchmarks consumption against the operator average", async () => {
    test.setTimeout(180_000);

    // The demo investor building ("Nordostpark 84") carries an annual aggregate, so
    // its energy view renders the comparison table (with the operator-average
    // column) rather than the 15-min series chart.
    await page.getByRole("tab", { name: "Manage" }).click();
    const annual = page.locator("li", { hasText: "Nordostpark" }).first();
    await expect(annual).toBeVisible({ timeout: 120_000 });
    const id = (await annual.textContent())?.match(/Building (\S+)/)?.[1];
    expect(id, "the annual demo building's id").toBeTruthy();

    await page.goto(`/#/energy/${id}`);
    await expect(
      page.getByRole("heading", { name: /Energy Need for Building/ }),
    ).toBeVisible({ timeout: 90_000 });

    // The building's own figures sit beside the operator-average benchmark column.
    // The comparison table repeats a plain "kWh / a" header per energy-type block,
    // so match the first (the assertion only proves the column exists).
    await expect(page.locator("th", { hasText: /^kWh \/ a$/ }).first())
      .toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator("th", { hasText: "Operator Average kWh / a" }).first(),
    ).toBeVisible({ timeout: 30_000 });
    // …and the table has at least one energy-type row under those columns.
    await expect(page.locator("tbody tr").first()).toBeVisible({
      timeout: 30_000,
    });
  });
});

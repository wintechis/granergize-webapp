import { expect, type Locator, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "../helpers/login.ts";

/**
 * Provenance-from-profile e2e (PROBLEMS.md #1). Proves a building's PROV
 * provenance comes from the **profile company kind** (org:classification on the
 * org node), not the import template: set the company kind to *Investor* but add
 * a building with the *User* template, then in Create View the building filters
 * under **Investor** (its provenance) and NOT under **User** (its template) —
 * `CreateViewDialog` filters `b.provenance === selectedRole`.
 *
 *   # tier 3 (local CSS, no creds):
 *   deno task e2e:local test/e2e/tasks/organisation.spec.ts
 *   # tier 4 (real Pods):
 *   source test/.env.e2e.local && deno task e2e:remote:spec test/e2e/tasks/organisation.spec.ts
 *
 * MUTATES the Pod but fully reverses itself: it restores the prior profile
 * company kind in afterAll and adds+deletes its one building. Runs against
 * Alice (account A). Skipped without creds.
 */

const ADDR = "Provenance E2E Strasse 1"; // unique, matchable building address

// The company kind this Pod had before the test, restored in afterAll so the
// spec fully reverses its profile mutation (defaults to "Not set" on a reseeded
// Pod). Captured from the dialog in the test.
let priorKind = "Not set";

/** Open the avatar-menu Organisation dialog (waits for the kind prefill). */
async function openOrgDialog(page: Page): Promise<Locator> {
  // Bounded clicks: Playwright's default action timeout is 0 (wait forever), so a
  // stuck click here would consume a whole hook budget UNCATCHABLY (the best-effort
  // afterAll restore could never swallow it). 15 s is ample for these interactions.
  await page.getByRole("button", { name: "Account menu" }).click({ timeout: 15_000 });
  await page.getByRole("menuitem", { name: /organisation/i })
    .click({ timeout: 15_000 });
  const org = page.getByRole("dialog");
  await expect(org).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => {}); // kind prefills async
  return org;
}

/** Select a company kind in the open Organisation dialog and save (Cancel if unchanged). */
async function setKindAndSave(
  page: Page,
  org: Locator,
  label: string,
): Promise<void> {
  const sel = org.getByLabel("Kind of company");
  if ((await sel.textContent())?.trim() === label) {
    await org.getByRole("button", { name: /cancel/i }).click({ timeout: 15_000 });
    return;
  }
  // Bounded clicks (see openOrgDialog) — a stuck dropdown/option/save click must not
  // hang a whole hook budget uncatchably.
  await sel.click({ timeout: 15_000 });
  await page.getByRole("option", { name: label, exact: true })
    .click({ timeout: 15_000 });
  await org.getByRole("button", { name: /^save$/i }).click({ timeout: 15_000 });
  await expect(page.getByText(/organisation saved/i))
    .toBeVisible({ timeout: 60_000 });
}

const ACC = account("A"); // Alice -- solo specs use one account

test.describe.configure({ mode: "serial" });

test.describe("provenance from profile", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_A / E2E_PASSWORD_A (a throwaway Solid Pod) to run the provenance e2e.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    page = await browser.newPage();
    page.on("dialog", (d) => d.accept().catch(() => {}));
    await login(page, ACC);
  });

  test.afterAll(async () => {
    // The restore opens the dialog + saves (setKindAndSave waits up to 60 s for
    // the "saved" toast), so the default 30 s hook budget is too tight — give it
    // room, otherwise a slow save fails teardown even though the test body passed.
    test.setTimeout(90_000);
    // Fully reverse the profile mutation: restore the kind this Pod started with.
    try {
      if (!page.isClosed()) {
        const org = await openOrgDialog(page);
        await setKindAndSave(page, org, priorKind);
      }
    } catch {
      // best-effort restore; never fail teardown
    } finally {
      await page.close();
    }
  });

  test("the profile company kind, not the template, sets a building's provenance", async () => {
    test.setTimeout(180_000);

    // 1. Capture the current company kind (to restore later), then set Investor.
    const org = await openOrgDialog(page);
    priorKind =
      (await org.getByLabel("Kind of company").textContent())?.trim() ||
      "Not set";
    await setKindAndSave(page, org, "Investor");

    // 2. Add a building with the USER template (≠ the profile kind). Wait for the
    //    Add Building control (always present once Manage has loaded), NOT a
    //    pre-existing building row — the Pod may legitimately have none.
    await page.getByRole("tab", { name: "Manage" }).click();
    const addBtn = page.getByRole("button", { name: "Add Building", exact: true })
      .first();
    await expect(addBtn).toBeVisible({ timeout: 120_000 });
    await addBtn.click();
    const add = page.getByRole("dialog");
    await add.getByLabel("Template").click();
    await page.getByRole("option", { name: "User", exact: true }).click();
    await add.getByLabel(/street address/i).fill(ADDR);
    await add.getByLabel(/locality/i).fill("Nürnberg");
    await add.getByLabel(/postal code/i).fill("90451");
    await add.getByLabel(/region/i).fill("Bayern");
    await add.getByLabel(/latitude/i).fill("49.45");
    await add.getByLabel(/longitude/i).fill("11.08");
    await add.getByRole("button", { name: /^Add Building$/ }).click();
    await expect(page.getByText(/building added/i))
      .toBeVisible({ timeout: 120_000 });

    // 3. Create View keys on provenance (CreateViewDialog filters
    //    b.provenance === selectedRole): the building must appear under the Investor
    //    filter (the profile company kind) — an exact provenance match — and must NOT appear
    //    under the User filter (its import template). So provenance came from the
    //    profile, not the template.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByRole("button", { name: /create view/i }).click();
    const view = page.getByRole("dialog");
    await expect(view).toBeVisible({ timeout: 30_000 });
    const option = page.getByRole("option", { name: new RegExp(ADDR) });

    // Under the Investor filter (the profile company kind) the building IS offered — that is
    // its actual provenance.
    await view.getByLabel("Role").click();
    await page.getByRole("option", { name: "Investor", exact: true }).click();
    await view.getByLabel("Select Buildings").click();
    await expect(option).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Escape");

    // Under the User filter (the import *template*) the building must NOT appear — had
    // provenance wrongly followed the template, it would. Don't assume "User" is even a
    // selectable role: whether it's offered depends on some OTHER user-provenance
    // building existing (a demo-seeded one, residue, …), independent of ours. If it is
    // offered, switch to it and confirm ours isn't among its buildings; if it isn't
    // offered at all, then no building is User-provenance, so ours certainly isn't.
    await view.getByLabel("Role").click();
    // The dropdown is open once Investor (our building's provenance) has rendered.
    await expect(page.getByRole("option", { name: "Investor", exact: true }))
      .toBeVisible({ timeout: 10_000 });
    const userRole = page.getByRole("option", { name: "User", exact: true });
    if (await userRole.count()) {
      await userRole.click();
      await view.getByLabel("Select Buildings").click();
      await expect(option).toHaveCount(0, { timeout: 10_000 });
      await page.keyboard.press("Escape");
    } else {
      await page.keyboard.press("Escape"); // no User role offered — ours can't be User
    }
    await view.getByRole("button", { name: /cancel/i }).click();

    // 4. Clean up the building.
    await page.getByRole("tab", { name: "Manage" }).click();
    const row = page.locator("li", { hasText: ADDR }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.getByRole("button", { name: "Delete building" }).click();
    await expect(page.getByText("Building deleted").first())
      .toBeVisible({ timeout: 90_000 });
  });

  // Upload a company logo in the Organisation dialog (PROBLEMS.md #11). Throwaway
  // Pod: the logo persists (no remove-logo UI to reverse it), which is fine.
  test("upload a company logo in the Organisation dialog", async () => {
    test.setTimeout(120_000);
    // A minimal 1×1 PNG, inline — no fixture file needed.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const org = await openOrgDialog(page);
    await org.locator('input[type="file"]').setInputFiles({
      name: "logo.png",
      mimeType: "image/png",
      buffer: png,
    });
    // The avatar preview picks up the chosen image (the Avatar's <img alt>).
    await expect(org.getByAltText("Organisation logo"))
      .toBeVisible({ timeout: 15_000 });
    await org.getByRole("button", { name: /^save$/i }).click();
    await expect(page.getByText(/organisation saved/i))
      .toBeVisible({ timeout: 60_000 });

    // Reopen → the logo persisted (the dialog's avatar still shows an image).
    const reopened = await openOrgDialog(page);
    await expect(reopened.getByAltText("Organisation logo"))
      .toBeVisible({ timeout: 30_000 });
    await reopened.getByRole("button", { name: /cancel/i }).click();
  });
});

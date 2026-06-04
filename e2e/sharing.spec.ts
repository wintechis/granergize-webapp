import { type Browser, expect, type Page, test } from "@playwright/test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { account, hasAccount, login, type SolidAccount } from "./helpers/login.ts";

/**
 * End-to-end sharing across TWO throwaway Solid Pods, using the data room to
 * discover WebIDs (so no WebID needs to be configured):
 *
 *   1. A hosts a data room and reads its URI.
 *   2. B joins that room and assigns the "User" role.
 *   3. A seeds a building and shares it "By role" → User; the room resolves the
 *      role to B's WebID.
 *   4. B sees the building under "Buildings shared with you".
 *
 * Requires two disposable accounts (never real ones) — see e2e/helpers/login.ts
 * and e2e/README.md:
 *
 *   E2E_USERNAME_A / E2E_PASSWORD_A / [E2E_ISSUER_A]
 *   E2E_USERNAME_B / E2E_PASSWORD_B / [E2E_ISSUER_B]
 *
 * Skipped automatically when those are absent. Run:
 *   npm run sharing            (headed:  npm run sharing -- --headed)
 *
 * NOTE: drives the live login/consent UI; selectors are best-effort for
 * solidcommunity.net and may need adjusting per provider.
 */

const A = account("A");
const B = account("B");
const STREET = "Teilenstraße 7";

/** On the Connect tab, host a room if none is active, and return its URI. */
async function hostRoomAndGetUri(page: Page): Promise<string> {
  await page.getByRole("tab", { name: "Connect" }).click();
  const roomLink = page.getByRole("link", { name: /https?:\/\/.*\/rooms\// });
  // Host a room only if not already in one (a "Current data room" link is shown).
  if (!(await roomLink.count())) {
    await page.getByRole("button", { name: /host a data room/i }).click();
  }
  // The room (existing or freshly hosted) shows as the "Current data room" link.
  await expect(roomLink.first()).toBeVisible({ timeout: 60_000 });
  const uri = (await roomLink.first().textContent())?.trim();
  expect(uri, "active room URI").toBeTruthy();
  // Settle: wait until no action is in flight (the Leave button is enabled) so a
  // following logout doesn't fire mid-operation. Tolerant — proceeds anyway.
  await expect(page.getByRole("button", { name: /leave data room/i }))
    .toBeEnabled({ timeout: 60_000 }).catch(() => {});
  return uri!;
}

/**
 * Assign the User role in the current room (MUI multi-select: open, tick, close,
 * save). Both A and B need a role: A to unlock "Add Building" (which is gated on
 * holding a room role), B to receive the share targeted at the User role.
 */
async function assignUserRole(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Connect" }).click();
  // The role for the CURRENT room loads async after entering it, and the select's
  // displayed text can briefly show the *previous* room's role — so deciding
  // "already User" from that text wrongly skips the save, leaving the new room
  // role-less. Wait for the load to settle, then read the actual option state
  // (aria-selected) inside the open menu, and only save when we actually changed
  // it (re-clicking an already-checked option would toggle it OFF).
  await page.waitForLoadState("networkidle").catch(() => {});
  const select = page.getByRole("combobox", { name: "My role(s)" });
  await expect(select).toBeVisible({ timeout: 15_000 });
  await select.click();
  const userOption = page.getByRole("option", { name: "User" });
  await expect(userOption).toBeVisible({ timeout: 10_000 });
  const alreadyUser = (await userOption.getAttribute("aria-selected")) === "true";
  if (!alreadyUser) await userOption.click();
  // Close the menu fully before saving — a half-closed menu's backdrop can eat
  // the first Save click (the symptom: role selected but never persisted).
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden({ timeout: 5_000 }).catch(
    () => {},
  );
  if (alreadyUser) return; // already persisted; nothing to save

  // Retry the Save click + success toast: the click can be eaten by the closing
  // menu, and the role write can be slow under throttle.
  await expect(async () => {
    await page.getByRole("button", { name: /save roles/i }).click();
    await expect(page.getByText(/roles updated/i)).toBeVisible({
      timeout: 10_000,
    });
  }).toPass({ timeout: 60_000 });
}

/**
 * On the Connect tab, add+enter a room URI and assign the User role. Idempotent and
 * tolerant of pre-existing room state (the throwaway Pod accumulates bookmarks
 * across runs): only adds the room if it isn't already bookmarked, then waits for
 * its bookmark button to actually appear before clicking it — so a slow/failed
 * `addRoom` surfaces as a clear "bookmark never showed" timeout rather than a
 * confusing click timeout. The bookmark's button label is the room URI (with a
 * trailing " (current)" once entered), so a substring match on the URI hits it
 * whether or not it's current.
 */
async function joinRoomAsUser(page: Page, roomUri: string): Promise<void> {
  await page.getByRole("tab", { name: "Connect" }).click();
  // Each bookmarked room is a row (li) showing its URI plus an "Enter data room"
  // action button (rooms list now mirrors the buildings list).
  const row = page.locator("li").filter({ hasText: roomUri });

  if (!(await row.count())) {
    const uriField = page.getByLabel(/data room uri/i);
    const add = page.getByRole("button", { name: /^add$/i });
    // `addRoom` does a network reachability check (roomExists) that can be
    // throttled on the shared Pod and then silently fail to bookmark; retry the
    // fill+Add until the row actually shows (the durable signal — the "added"
    // toast is transient).
    await expect(async () => {
      if (await row.count()) return;
      await uriField.fill(roomUri);
      await expect(add).toBeEnabled({ timeout: 5_000 });
      await add.click();
      await expect(row.first()).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 90_000 });
  }

  // Enter the room via its row action (absent if it's already current).
  const enter = row.first().getByRole("button", { name: /enter data room/i });
  if (await enter.count()) await enter.click();
  await expect(page.getByRole("button", { name: /leave data room/i }))
    .toBeVisible({ timeout: 30_000 });
  await assignUserRole(page);
}

/** A fresh isolated context logged into one account. */
async function freshPage(
  browser: Browser,
  acc: SolidAccount,
): Promise<{ ctx: Awaited<ReturnType<Browser["newContext"]>>; page: Page }> {
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 900 },
  });
  const page = await ctx.newPage();
  await login(page, acc);
  return { ctx, page };
}

// The room URI is handed from "part 1" (A hosts) to "part 2" (B joins) via a
// gitignored file (`*.local` is ignored), so each part can run as its own
// process after a cooldown without re-discovering the room.
const STATE_FILE = new URL("./.sharing-state.local.json", import.meta.url);
function saveRoomUri(roomUri: string): void {
  writeFileSync(STATE_FILE, JSON.stringify({ roomUri }, null, 2));
}
function loadRoomUri(): string {
  if (!existsSync(STATE_FILE)) {
    throw new Error("No saved room URI — run \"part 1\" first.");
  }
  return JSON.parse(readFileSync(STATE_FILE, "utf8")).roomUri as string;
}

test.describe("sharing across two pods", () => {
  test.skip(
    !hasAccount(A) || !hasAccount(B),
    "Set E2E_{USERNAME,PASSWORD}_A and _B (throwaway Pods).",
  );

  // Split into FOUR single-account parts so each run is one login + a small write
  // burst — the live Pod (solidcommunity.net behind Cloudflare) rate-limits bursts
  // of cross-Pod writes, so concentrating one actor's writes per run and waiting
  // between them keeps each under the limit. Run in order, letting the limit relax
  // between parts; state persists on the Pods (+ the room URI in a local file):
  //   source .env.e2e.local && deno task e2e -g "part 1"   # A hosts + role
  //   …wait…  deno task e2e -g "part 2"                     # B joins + role
  //   …wait…  deno task e2e -g "part 3"                     # A shares
  //   …wait…  deno task e2e -g "part 4"                     # B sees it

  test("part 1: A hosts a room and takes the User role", async ({ browser }) => {
    test.setTimeout(300_000);
    const { ctx, page } = await freshPage(browser, A);
    try {
      const roomUri = await hostRoomAndGetUri(page);
      await assignUserRole(page);
      saveRoomUri(roomUri);
    } finally {
      await ctx.close();
    }
  });

  test("part 2: B joins the room and takes the User role", async ({ browser }) => {
    test.setTimeout(300_000);
    const roomUri = loadRoomUri();
    const { ctx, page } = await freshPage(browser, B);
    try {
      await joinRoomAsUser(page, roomUri);
    } finally {
      await ctx.close();
    }
  });

  test("part 3: A shares a building with the User role", async ({ browser }) => {
    test.setTimeout(300_000);
    const { ctx, page } = await freshPage(browser, A);
    try {
      // A's current room (hosted in part 1) persists on the Pod, so "by role"
      // resolution finds B (who joined in part 2). Ensure a building, then share.
      await page.getByRole("tab", { name: "Manage" }).click();
      const dialog = page.getByRole("dialog");

      // The empty-state text shows transiently WHILE the list loads, so it can't
      // decide "A has no buildings". Wait for the network to go idle, then give a
      // building's Share action a real chance to appear before treating A as empty.
      await page.waitForLoadState("networkidle").catch(() => {});
      const shareAction = page.getByRole("button", {
        name: "Share building data",
      });
      const hasBuilding = await shareAction.first()
        .waitFor({ state: "visible", timeout: 20_000 })
        .then(() => true).catch(() => false);

      // Seed a building only if A truly owns none.
      if (!hasBuilding) {
        await page.getByRole("button", { name: /^add building$/i }).click();
        await expect(dialog).toBeVisible({ timeout: 10_000 });
        // The dialog needs A's room role to render the Role-specific form; that
        // role data also loads async, so wait for the Role field before using it.
        // Pick User explicitly (A may hold several roles): an investor-shaped
        // form has extra required fields (buildingCode) that would block submit.
        await expect(dialog.getByLabel("Role")).toBeVisible({ timeout: 15_000 });
        await dialog.getByLabel("Role").click();
        await page.getByRole("option", { name: "User" }).click();
        await dialog.getByLabel(/street address/i).fill(STREET);
        await dialog.getByLabel(/locality/i).fill("Nürnberg");
        await dialog.getByLabel(/postal code/i).fill("90451");
        await dialog.getByLabel(/region/i).fill("Bayern");
        await dialog.getByLabel(/latitude/i).fill("49.45");
        await dialog.getByLabel(/longitude/i).fill("11.08");
        await dialog.getByRole("button", { name: /^add building$/i }).click();
        await expect(dialog).toBeHidden({ timeout: 30_000 });
        await expect(shareAction.first()).toBeVisible({ timeout: 30_000 });
      }

      // Share from the building's row on the Manage tab (the map detail pane is
      // view-only now): click the row's "Share building data" action.
      const shareBtn = shareAction.first();
      await expect(shareBtn).toBeVisible({ timeout: 30_000 });
      await shareBtn.click();

      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.getByRole("button", { name: /by role/i }).click();
      await dialog.getByLabel("Role").click();
      await page.getByRole("option", { name: "User" }).click();
      // "Review & Share" resolves the role to member WebIDs over the network; that
      // read can be throttled ("Could not load data room members: Failed to
      // fetch"), so retry it until the review step's Confirm button appears.
      const confirm = dialog.getByRole("button", { name: /confirm share/i });
      await expect(async () => {
        await dialog.getByRole("button", { name: /review & share/i }).click();
        await expect(confirm).toBeVisible({ timeout: 10_000 });
      }).toPass({ timeout: 90_000 });
      await confirm.click();
      // The share itself does several Pod writes (ACL grant + inbox + registry);
      // give it a generous window under throttle.
      await expect(dialog.getByText(/shared successfully/i)).toBeVisible({
        timeout: 120_000,
      });
      await dialog.getByRole("button", { name: /done/i }).click();
    } finally {
      await ctx.close();
    }
  });

  test("part 4: B sees the building under Buildings shared with you", async ({ browser }) => {
    test.setTimeout(300_000);
    // The grant part 3 left on the Pods propagates into B's "Buildings shared with
    // you" — it lands in B's inbox and is copied into B's registry on load, so a
    // reload may be needed.
    const { ctx, page } = await freshPage(browser, B);
    try {
      await page.getByRole("tab", { name: "Share" }).click();
      const received = page.getByRole("heading", {
        name: /buildings shared with you/i,
      }).locator("xpath=following-sibling::*[1]");
      await expect(async () => {
        await page.reload();
        await page.getByRole("tab", { name: "Share" }).click();
        await expect(received.getByText(/^Building /)).toBeVisible({
          timeout: 5_000,
        });
      }).toPass({ timeout: 90_000 });
    } finally {
      await ctx.close();
    }
  });
});

import { expect, type Page, test } from "@playwright/test";
import { account, hasAccount, login } from "./helpers/login.ts";
import { deleteAllOwnedRooms } from "./helpers/rooms.ts";

/**
 * DIAGNOSTIC (not an assertion test): pins which layer makes room-switching
 * unreliable. It hosts two rooms, switches the active room back and forth, and
 * logs every room-registry request/response — `prefs.ttl` (holds the active-room
 * pointer `gran:currentRoom`) and `bookmarks.ttl` (the room list) — with method,
 * status, ETag, the conditional headers (If-None-Match / If-Match), and the
 * `current` parsed from each `prefs.ttl` GET body. Read the printed exchange to
 * classify a switch that reverts:
 *   - PUT 200/205 then GET 200 with current=<new room>  → client bug (refetch/UI)
 *   - GET 304, or 200 with current=<old room>           → server/CDN serves a
 *                                                          stale conditional read
 *   - 429                                                → throttling
 *
 *   source .env.e2e.local && deno task e2e data-room-switch-debug
 *
 * Run on a freshly reset / cooled-down Pod for a clean signal. Credential-gated.
 * (The active-room pointer lives in `prefs.ttl` since the storage redesign — it
 * was `rooms.ttl` before.)
 */

// A and B are interchangeable fast Pods; default B, override E2E_DEBUG_ACCOUNT=A.
const WHICH = (process.env.E2E_DEBUG_ACCOUNT === "A" ? "A" : "B") as "A" | "B";
const ACC = account(WHICH);

test.describe("data-room switch — network diagnosis", () => {
  test.skip(
    !hasAccount(ACC),
    `Set E2E_USERNAME_${WHICH} / E2E_PASSWORD_${WHICH} (a throwaway Solid Pod) to run the diagnostic.`,
  );

  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000); // login (IdP + consent) can be slow / retried
    page = await browser.newPage();
    // "Delete data room" confirms via window.confirm — accept automatically.
    page.on("dialog", (d) => d.accept());
    await login(page, ACC);
  });

  test.afterAll(async () => {
    // Teardown lives here, not in the test body, so a mid-switch timeout (this
    // slow diagnostic's common failure mode) can't skip it and leak the two
    // hosted rooms.
    await deleteAllOwnedRooms(page);
    await page.close();
  });

  test("capture the room-registry (prefs.ttl/bookmarks.ttl) exchange around switches", async () => {
    test.setTimeout(240_000);
    const short = (uri: string) => uri.split("/rooms/")[1] ?? uri;
    // The room registry is now two files (storage redesign): the active-room
    // pointer in prefs.ttl, the bookmark list in bookmarks.ttl. Tag each line
    // with which one so the exchange stays readable.
    const registryFile = (u: string): string | null =>
      u.includes("prefs.ttl")
        ? "prefs"
        : u.includes("bookmarks.ttl")
        ? "bookmarks"
        : null;
    // Stream each exchange line immediately (console.log appears live in the
    // run output) so we still see the evidence even if the run is slow / times out.
    page.on("request", (r) => {
      const file = registryFile(r.url());
      if (!file) return;
      const h = r.headers();
      console.log(
        `[req] ${file.padEnd(9)} ${r.method().padEnd(4)} INM=${
          h["if-none-match"] ?? "-"
        } IM=${h["if-match"] ?? "-"}`,
      );
    });
    page.on("response", async (r) => {
      const file = registryFile(r.url());
      if (!file) return;
      const method = r.request().method();
      const status = r.status();
      const etag = r.headers()["etag"] ?? "-";
      let current = "";
      if (file === "prefs" && method === "GET" && status === 200) {
        try {
          const m = (await r.text()).match(/currentRoom>?\s*<([^>]+)>/);
          current = m ? ` current=${short(m[1])}` : " current=(none)";
        } catch {
          current = " current=(no body)";
        }
      }
      console.log(
        `[res] ${file.padEnd(9)} ${method.padEnd(4)} ${status} etag=${etag}${current}`,
      );
    });

    console.log(`// account ${WHICH} @ ${ACC.issuer}`);
    await page.getByRole("tab", { name: "Connect" }).click();

    const hostRoom = async (): Promise<string> => {
      await page.getByRole("button", { name: /host a data room/i }).click();
      const leave = page.getByRole("button", { name: "Leave data room" });
      await expect(leave).toBeVisible({ timeout: 45_000 });
      const uri = await page.locator("li").filter({ has: leave })
        .locator("a[href]").first().getAttribute("href");
      return uri as string;
    };

    console.log("// host room A");
    const a = await hostRoom();
    console.log("// host room B (leaves A → B active)");
    const b = await hostRoom();
    const rowA = page.locator("li").filter({ hasText: a });
    const rowB = page.locator("li").filter({ hasText: b });
    console.log(`// A=${short(a)}  B=${short(b)}`);

    // One round-trip: switch to A, then to B. Each click triggers enterRoom
    // (PUT current) → invalidate → refetch (GET current). The streamed [req]/[res]
    // lines around each UI line show whether the GET reads back the new current.
    console.log("// switch → A");
    await rowA.getByRole("button", { name: "Enter data room" }).click();
    await page.waitForTimeout(5000);
    console.log(`   UI: A=${await buttonOf(rowA)}  B=${await buttonOf(rowB)}`);

    console.log("// switch → B");
    await rowB.getByRole("button", { name: "Enter data room" }).click().catch(
      () => console.log("   (A didn't become active — Enter on B unavailable)"),
    );
    await page.waitForTimeout(5000);
    console.log(`   UI: A=${await buttonOf(rowA)}  B=${await buttonOf(rowB)}`);

    // Rooms are torn down in afterAll (so a timeout can't skip cleanup).

    async function buttonOf(row: ReturnType<typeof page.locator>) {
      if (await row.getByRole("button", { name: "Leave data room" }).count()) {
        return "active(Leave)";
      }
      if (await row.getByRole("button", { name: "Enter data room" }).count()) {
        return "inactive(Enter)";
      }
      return "gone";
    }
  });
});

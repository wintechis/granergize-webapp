import { expect, type Page } from "@playwright/test";
import { T } from "./timeouts.ts";

/**
 * Reload `page`, then run `check`, retrying the pair until it passes (or `timeout`
 * elapses). The reload is the point: a fresh load re-runs the app's login → inbox
 * drain / cold re-fetch, so this is the honest way to wait on CROSS-POD propagation
 * (A writes on its Pod; B sees it only after its next drain) — never a blind
 * `waitForTimeout`. `check` asserts the observable post-condition: a shared
 * row/file/view appearing, or — after a revoke/delete — folding out.
 */
export async function reloadUntil(
  page: Page,
  check: () => Promise<void>,
  timeout: number = T.poll,
): Promise<void> {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout });
}

import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";
import {
  ACTOR_THEMES,
  CAPTION_ID,
  installOverlayScript,
} from "./overlay.ts";

/**
 * Playwright side of the demo polish for recorded handbuch videos: installs
 * the overlay (fake cursor, caption banner, actor badge — built in
 * `overlay.ts`) and wraps the page interactions in deliberate, watchable
 * pacing (smooth mouse travel, pauses around clicks, per-character typing).
 *
 * Scene marks: `scene(...)` records the elapsed ms since the recording
 * started, so post-processing can trim the setup head and find cut points
 * (`<name>.marks.json` next to the saved video — see `postprocess.sh`).
 */

const AVATARS: Record<"A" | "B" | "C", string> = {
  A: "test/e2e/fixtures/alice-avatar.png",
  B: "test/e2e/fixtures/bob-avatar.png",
  C: "test/e2e/fixtures/charlie-avatar.png",
};

export interface SceneMark {
  label: string;
  caption: string;
  /** ms since the recording (≈ the page's context) started */
  t: number;
}

export class Demo {
  readonly marks: SceneMark[] = [];

  private constructor(
    readonly page: Page,
    private readonly t0: number,
  ) {}

  /**
   * Install the overlay for `slot` on `page`. Pass `t0` = the timestamp the
   * recording started (capture `Date.now()` first thing in the test — the
   * context, and with it the video, starts moments before the body runs).
   */
  static async install(
    page: Page,
    slot: "A" | "B" | "C",
    t0: number,
  ): Promise<Demo> {
    const avatar = `data:image/png;base64,${
      readFileSync(AVATARS[slot]).toString("base64")
    }`;
    const script = installOverlayScript(ACTOR_THEMES[slot], avatar);
    await page.addInitScript({ content: script }); // survives reload/goto
    await page.evaluate(script); // and the document already open
    return new Demo(page, t0);
  }

  /** Mark a scene start and show its caption (the walkthrough step text). */
  async scene(label: string, caption: string): Promise<void> {
    this.marks.push({ label, caption, t: Date.now() - this.t0 });
    await this.caption(caption);
  }

  /** Show (or, with "", hide) the caption banner; hold so viewers can read. */
  async caption(text: string, holdMs = 2_200): Promise<void> {
    await this.page.evaluate(
      ([id, text]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        el.toggleAttribute("hidden", !text);
      },
      [CAPTION_ID, text] as const,
    );
    if (text) await this.pause(holdMs);
  }

  async pause(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /** Travel the (fake) cursor smoothly onto the target's center. */
  async moveTo(target: Locator): Promise<void> {
    await target.scrollIntoViewIfNeeded().catch(() => {});
    const box = await target.boundingBox();
    if (!box) return;
    await this.page.mouse.move(
      box.x + box.width / 2,
      box.y + box.height / 2,
      { steps: 25 },
    );
  }

  /** A deliberate click: travel, settle, click, settle. */
  async click(target: Locator): Promise<void> {
    await this.moveTo(target);
    await this.pause(400);
    await target.click();
    await this.pause(300);
  }

  /** Click into a field and type its value per-character. */
  async type(target: Locator, text: string): Promise<void> {
    await this.click(target);
    await target.fill(""); // typing must not append to a pre-loaded value
    await target.pressSequentially(text, { delay: 70 });
    await this.pause(250);
  }

  /** Open a MUI select and pick an option, both with cursor travel. */
  async select(combobox: Locator, option: string | RegExp): Promise<void> {
    await this.click(combobox);
    await this.click(this.page.getByRole("option", { name: option }));
  }
}

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import type { Locator, Page } from "@playwright/test";
import {
  ACTOR_THEMES,
  CAPTION_ID,
  endCardHtml,
  installOverlayScript,
  INTRO_ID,
  introCardHtml,
  loadingCardHtml,
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

const dataUri = (path: string, mime: string) =>
  `data:${mime};base64,${readFileSync(path).toString("base64")}`;
const avatarUri = (slot: "A" | "B" | "C") => dataUri(AVATARS[slot], "image/png");
const brandLogoUri = () => dataUri("public/favicon.svg", "image/svg+xml");

/** QR as inline SVG markup, rendered in this Node process via qrcode.react. */
const qrSvg = (value: string) =>
  renderToStaticMarkup(createElement(QRCodeSVG, {
    value,
    size: 120,
    fgColor: "#1d1d1f",
    bgColor: "#ffffff",
  }));

/** The two project pages the end card's QR codes point at (login footer). */
const PROJECT_FAU = "https://www.ti.rw.fau.de/granergize/";
const PROJECT_IIS =
  "https://www.scs.fraunhofer.de/de/referenzen/granergize-graphenbasierter-datenraum-logistikimmobilien.html";

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
    const script = installOverlayScript(ACTOR_THEMES[slot]);
    await page.addInitScript({ content: script }); // survives reload/goto
    await page.evaluate(script); // and the document already open
    return new Demo(page, t0);
  }

  /** Show full-frame card HTML in the intro/end container. */
  private async showCard(html: string, light = false): Promise<void> {
    await this.page.evaluate(
      ([id, html, light]) => {
        const el = document.getElementById(id as string);
        if (!el) return;
        el.innerHTML = html as string;
        el.classList.toggle("demo-card-light", !!light);
        el.classList.remove("demo-intro-fading");
        el.hidden = false;
      },
      [INTRO_ID, html, light] as const,
    );
  }

  private async fadeOutCard(): Promise<void> {
    await this.page.evaluate((id) => {
      document.getElementById(id)?.classList.add("demo-intro-fading");
    }, INTRO_ID);
    await this.pause(500); // the CSS fade
    await this.page.evaluate((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }, INTRO_ID);
  }

  /**
   * Scene zero, two beats. First a ~1 s replica of the app's branded
   * "Loading…" screen (`ActivityScreen`), so the video opens exactly like
   * the app does — the stage page has long settled by now, and without this
   * the trimmed video opened on a flash of the logged-in screen. Then the
   * full-frame cast card — title, then every participant with avatar, name,
   * company and a one-line problem statement — so the actors and the problem
   * are established before the resolution starts. The card hold scales with
   * the cast (more taglines = more reading time) unless overridden. Fades
   * out. The loading beat is the clip's first scene mark = the trim point.
   */
  async intro(
    title: string,
    cast: Array<{ slot: "A" | "B" | "C"; tagline: string }>,
    holdMs?: number,
  ): Promise<void> {
    this.marks.push({
      label: "loading",
      caption: "Loading…",
      t: Date.now() - this.t0,
    });
    // Held 1.6 s: postprocess cuts ~0.4 s INTO this flash (see its comment),
    // so ≥1 s of it survives as the video's opening.
    await this.showCard(loadingCardHtml(brandLogoUri()), true);
    await this.pause(1_600);
    this.marks.push({ label: "intro", caption: title, t: Date.now() - this.t0 });
    await this.showCard(introCardHtml(
      title,
      cast.map((c) => ({
        theme: ACTOR_THEMES[c.slot],
        avatarDataUri: avatarUri(c.slot),
        tagline: c.tagline,
      })),
    ));
    await this.pause(holdMs ?? 3_500 + 2_500 * cast.length);
    await this.fadeOutCard();
  }

  /**
   * The closing card every video holds on (no fade-out — the video ends on
   * it): the project contact and QR codes for the two project pages. The
   * hold leaves time to scan a QR.
   */
  async outro(holdMs = 10_000): Promise<void> {
    this.marks.push({
      label: "outro",
      caption: "Granergize",
      t: Date.now() - this.t0,
    });
    await this.showCard(endCardHtml({
      qrFauSvg: qrSvg(PROJECT_FAU),
      qrIisSvg: qrSvg(PROJECT_IIS),
    }));
    await this.pause(holdMs);
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
    await this.pause(550);
    await target.click();
    await this.pause(450);
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

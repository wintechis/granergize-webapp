/**
 * Pure builders for the demo-polish overlay injected into recorded handbuch
 * videos (see notes/plan-handbuch-videos.md): a fake cursor that follows the
 * real mouse events, a bottom caption banner carrying the walkthrough step
 * text, and a persistent corner badge identifying the actor whose screen is
 * shown. Everything here returns strings (CSS / HTML / an injectable script),
 * so it is unit-testable without a browser; the Playwright side
 * (`demoPolish.ts`) injects the script and drives the caption.
 */

/** One walkthrough actor's on-screen identity. Accent colors follow the
 * actors' logo marks (A/B) resp. the BSP yellow of the scenario diagrams (C);
 * all three trace back to the Lego-head avatar tones. */
export interface ActorTheme {
  slot: "A" | "B" | "C";
  name: string;
  company: string;
  accent: string;
}

export const ACTOR_THEMES: Record<"A" | "B" | "C", ActorTheme> = {
  A: {
    slot: "A",
    name: "Alice Ahlmann",
    company: "Ahlmann Logistik GmbH",
    accent: "#894c40",
  },
  B: {
    slot: "B",
    name: "Bob Bauer",
    company: "Bauer Grundbesitz",
    accent: "#573c31",
  },
  C: {
    slot: "C",
    name: "Charlie Conrad",
    company: "Conrad Kennwert GmbH",
    accent: "#d9a900",
  },
};

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Element ids, shared between the injected script and the caption driver. */
export const CURSOR_ID = "demo-cursor";
export const CAPTION_ID = "demo-caption";
export const INTRO_ID = "demo-intro";

/**
 * Overlay stylesheet. Every element is `pointer-events: none` (the overlay
 * must never swallow a click meant for the app) and sits above MUI's modal
 * stack. The cursor is a soft ring-and-dot (the usual screencast affordance —
 * an arrow would fight the real, hidden OS cursor's semantics); `mousedown`
 * shrinks it so clicks read on screen.
 */
export function overlayCss(accent: string): string {
  return `
#${CURSOR_ID}, #${CAPTION_ID}, #${INTRO_ID} {
  pointer-events: none;
  position: fixed;
  z-index: 2147483000;
  font-family: "Roboto", "Helvetica", "Arial", sans-serif;
}
#${CURSOR_ID} {
  left: -100px; top: -100px;
  width: 26px; height: 26px;
  margin: -13px 0 0 -13px;
  border-radius: 50%;
  border: 2.5px solid ${accent};
  background: ${accent}33;
  box-shadow: 0 0 0 1.5px #ffffffcc;
  transition: transform 80ms ease-out;
}
#${CURSOR_ID}.demo-cursor-down { transform: scale(0.55); }
#${CAPTION_ID} {
  left: 50%; bottom: 18px;
  transform: translateX(-50%);
  max-width: 62%;
  padding: 10px 18px;
  border-radius: 8px;
  border-left: 5px solid ${accent};
  background: #1d1d1fd9;
  color: #fff;
  font-size: 17px; line-height: 1.4;
  text-align: center;
}
#${CAPTION_ID}[hidden] { display: none; }
#${INTRO_ID} {
  inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 36px;
  background: #1d1d1f;
  opacity: 1;
  transition: opacity 450ms ease;
}
#${INTRO_ID}.demo-card-light { background: #fff; }
#${INTRO_ID} .demo-loading-col {
  width: 100%; max-width: 720px;
  display: flex; flex-direction: column; align-items: flex-start;
  gap: 24px;
  padding: 0 16px;
}
#${INTRO_ID} .demo-loading-col img { width: 64px; display: block; }
#${INTRO_ID} .demo-loading-title {
  color: #1d1d1f; font-size: 20px; font-weight: 500;
}
#${INTRO_ID}[hidden] { display: none; }
#${INTRO_ID}.demo-intro-fading { opacity: 0; }
#${INTRO_ID} .demo-intro-title {
  color: #fff; font-size: 30px; font-weight: 600;
}
#${INTRO_ID} .demo-intro-cast {
  display: flex; gap: 56px; align-items: flex-start; justify-content: center;
}
#${INTRO_ID} .demo-intro-actor {
  display: flex; flex-direction: column; align-items: center;
  gap: 6px; max-width: 280px; text-align: center;
}
#${INTRO_ID} .demo-intro-actor img {
  width: 96px; height: 96px;
  border-radius: 50%;
  object-fit: cover;
  background: #fff;
  border: 3px solid var(--demo-accent);
  margin-bottom: 6px;
}
#${INTRO_ID} .demo-intro-name { color: #fff; font-size: 19px; font-weight: 600; }
#${INTRO_ID} .demo-intro-company { color: #c9c9c9; font-size: 14px; }
#${INTRO_ID} .demo-intro-tagline {
  color: #e8e8e8; font-size: 15px; font-style: italic; margin-top: 8px;
}
#${INTRO_ID} .demo-end-contact { color: #e8e8e8; font-size: 17px; text-align: center; line-height: 1.6; }
#${INTRO_ID} .demo-end-contact a { color: #e8e8e8; }
#${INTRO_ID} .demo-end-ack {
  color: #b5b5b5; font-size: 13px; text-align: center; line-height: 1.6;
}
#${INTRO_ID} .demo-end-row {
  display: flex; gap: 48px; align-items: center; justify-content: center;
}
#${INTRO_ID} .demo-end-panel {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
}
#${INTRO_ID} .demo-end-panel .demo-end-box {
  background: #fff; border-radius: 10px; padding: 12px;
  display: flex; align-items: center; justify-content: center;
}
#${INTRO_ID} .demo-end-panel img { max-height: 96px; display: block; }
#${INTRO_ID} .demo-end-label { color: #fff; font-size: 15px; font-weight: 600; }
`;
}

/** One actor's entry on the intro card: identity plus their stake/problem. */
export interface IntroEntry {
  theme: ActorTheme;
  avatarDataUri: string;
  /** One line: this actor's problem or stake in the use case. */
  tagline: string;
}

/**
 * A replica of the app's own branded "Loading…" screen (`ActivityScreen`:
 * the G mark over a left-aligned 720px column) — flashed for about a second
 * as every video's very first frame, so the video opens exactly like the app
 * does, before the title card. (The real restore screen's duration varies;
 * the replica makes the open deterministic.)
 */
export function loadingCardHtml(logoDataUri: string): string {
  return `<div class="demo-loading-col">` +
    `<img src="${escapeHtml(logoDataUri)}" alt="">` +
    `<span class="demo-loading-title">Loading…</span></div>`;
}

/**
 * The intro card's inner HTML — an OPAQUE, splash-style title page shown
 * after the loading flash (the app must not show through): the use-case
 * title, then each participant (avatar, name, company) with a one-line
 * problem statement, so the actors and the problem are established before
 * the resolution starts. No brand row — the Granergize mark is established
 * by the loading flash. Escaped throughout.
 */
export function introCardHtml(
  title: string,
  cast: IntroEntry[],
): string {
  const actors = cast.map((entry) =>
    `<div class="demo-intro-actor" style="--demo-accent: ${
      escapeHtml(entry.theme.accent)
    }">` +
    `<img src="${escapeHtml(entry.avatarDataUri)}" alt="">` +
    `<span class="demo-intro-name">${escapeHtml(entry.theme.name)}</span>` +
    `<span class="demo-intro-company">${escapeHtml(entry.theme.company)}</span>` +
    `<span class="demo-intro-tagline">${escapeHtml(entry.tagline)}</span>` +
    `</div>`
  ).join("");
  return `<div class="demo-intro-title">${escapeHtml(title)}</div>` +
    `<div class="demo-intro-cast">${actors}</div>`;
}

/** What the end card shows; the `qr*Svg` fields are TRUSTED generated SVG
 * markup (from `qrcode.react`), embedded verbatim — everything else escaped. */
export interface EndCardContent {
  qrFauSvg: string;
  qrIisSvg: string;
}

/**
 * The end card's inner HTML — the closing splash every video holds on: the
 * project contact (Thomas Wehr), QR codes for the two project pages
 * (Granergize@FAU · Granergize@IIS), and the funding acknowledgment
 * (wording mirrors the handbuch's "Was steckt hinter Granergize").
 */
export function endCardHtml(c: EndCardContent): string {
  const panel = (boxContent: string, label: string) =>
    `<div class="demo-end-panel"><div class="demo-end-box">${boxContent}</div>` +
    `<span class="demo-end-label">${escapeHtml(label)}</span></div>`;
  return `<div class="demo-end-contact">Forschungsprojekt Granergize<br>` +
    `Kontakt: Thomas Wehr &middot; thomas.wehr@fau.de</div>` +
    `<div class="demo-end-row">` +
    panel(c.qrFauSvg, "Granergize@FAU") +
    panel(c.qrIisSvg, "Granergize@IIS") +
    `</div>` +
    `<div class="demo-end-ack">Gef&ouml;rdert durch das BMWE &middot; ` +
    `Industrielle Gemeinschaftsforschung (IGF) &middot; ` +
    `F&ouml;rderkennzeichen 01IF23286N</div>`;
}

/**
 * The complete injectable script (a self-contained IIFE string for
 * `page.addInitScript`/`page.evaluate`): installs the stylesheet, the overlay
 * elements, and document-level listeners that drive the fake cursor from the
 * real mouse events Playwright dispatches. Actor identity on screen is the
 * cursor's accent color plus the captions/intro card — there is deliberately
 * no persistent badge (it was redundant next to the app header and the intro
 * card). Idempotent — a reload re-runs the init script, an extra evaluate
 * must not double the overlay.
 */
export function installOverlayScript(theme: ActorTheme): string {
  const css = JSON.stringify(overlayCss(theme.accent));
  return `(() => {
  const install = () => {
    if (document.getElementById("demo-overlay-style")) return;
    const style = document.createElement("style");
    style.id = "demo-overlay-style";
    style.textContent = ${css};
    document.head.appendChild(style);
    const make = (id) => {
      const el = document.createElement("div");
      el.id = id;
      document.body.appendChild(el);
      return el;
    };
    make(${JSON.stringify(CURSOR_ID)});
    make(${JSON.stringify(CAPTION_ID)}).hidden = true;
    make(${JSON.stringify(INTRO_ID)}).hidden = true;
    document.addEventListener("mousemove", (e) => {
      const c = document.getElementById(${JSON.stringify(CURSOR_ID)});
      if (c) {
        c.style.left = e.clientX + "px";
        c.style.top = e.clientY + "px";
      }
    }, true);
    document.addEventListener("mousedown", () => {
      const c = document.getElementById(${JSON.stringify(CURSOR_ID)});
      if (c) c.classList.add("demo-cursor-down");
    }, true);
    document.addEventListener("mouseup", () => {
      const c = document.getElementById(${JSON.stringify(CURSOR_ID)});
      if (c) c.classList.remove("demo-cursor-down");
    }, true);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else install();
})();`;
}

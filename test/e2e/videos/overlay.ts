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
export const BADGE_ID = "demo-badge";

/**
 * Overlay stylesheet. Every element is `pointer-events: none` (the overlay
 * must never swallow a click meant for the app) and sits above MUI's modal
 * stack. The cursor is a soft ring-and-dot (the usual screencast affordance —
 * an arrow would fight the real, hidden OS cursor's semantics); `mousedown`
 * shrinks it so clicks read on screen.
 */
export function overlayCss(accent: string): string {
  return `
#${CURSOR_ID}, #${CAPTION_ID}, #${BADGE_ID} {
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
#${BADGE_ID} {
  left: 14px; bottom: 14px;
  display: flex; align-items: center; gap: 10px;
  padding: 6px 14px 6px 6px;
  border-radius: 999px;
  border: 2px solid ${accent};
  background: #ffffffe6;
  box-shadow: 0 1px 6px #00000033;
}
#${BADGE_ID} img {
  width: 34px; height: 34px;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}
#${BADGE_ID} .demo-badge-name { font-size: 14px; font-weight: 600; color: #1d1d1f; }
#${BADGE_ID} .demo-badge-company { font-size: 12px; color: #555; }
`;
}

/** The actor badge's inner HTML (avatar + person + company), escaped. */
export function badgeHtml(theme: ActorTheme, avatarDataUri: string): string {
  return `<img src="${escapeHtml(avatarDataUri)}" alt="">` +
    `<span><span class="demo-badge-name">${escapeHtml(theme.name)}</span><br>` +
    `<span class="demo-badge-company">${escapeHtml(theme.company)}</span></span>`;
}

/**
 * The complete injectable script (a self-contained IIFE string for
 * `page.addInitScript`/`page.evaluate`): installs the stylesheet, the three
 * overlay elements, and document-level listeners that drive the fake cursor
 * from the real mouse events Playwright dispatches. Idempotent — a reload
 * re-runs the init script, an extra evaluate must not double the overlay.
 */
export function installOverlayScript(
  theme: ActorTheme,
  avatarDataUri: string,
): string {
  const css = JSON.stringify(overlayCss(theme.accent));
  const badge = JSON.stringify(badgeHtml(theme, avatarDataUri));
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
    make(${JSON.stringify(BADGE_ID)}).innerHTML = ${badge};
    make(${JSON.stringify(CAPTION_ID)}).hidden = true;
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

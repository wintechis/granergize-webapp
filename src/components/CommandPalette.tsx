import { lazy, Suspense, useEffect, useState } from "react";

/** A visible header button dispatches this on `globalThis` to open the palette
 * without the keyboard — also a path around the browser's Ctrl-K collision. */
export const OPEN_PALETTE_EVENT = "granergize:open-palette";

// The palette body pulls in the whole intent registry (and its transitive deps —
// mastr/navTrail/charts/LLM-translate), so load it lazily: this host carries only
// the cheap global listeners, and the heavy chunk arrives on first open, not at
// first paint.
const CommandPaletteBody = lazy(() => import("./CommandPaletteBody.tsx"));

/**
 * The global ⌘K command palette, mounted once in the app shell. This thin host
 * owns the open state and the global open triggers — the `⌘K` / `Ctrl-K` hotkey
 * and the header button's {@link OPEN_PALETTE_EVENT} — and renders the heavy
 * {@link CommandPaletteBody} (lazy) only once the palette has first been opened.
 * The body is a controlled dialog driven by `open` / `onClose`.
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  // Stays true once the palette has been opened at least once: the lazy body
  // chunk is fetched on that first open and the component then stays mounted, so
  // its close transition plays and reopening is instant.
  const [mounted, setMounted] = useState(false);

  // ⌘K / Ctrl-K toggles the palette (and mounts the body on the first open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setMounted(true);
        setOpen((v) => !v);
      }
    };
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, []);

  // A visible header button opens the palette via this event (no keyboard needed).
  useEffect(() => {
    const onOpen = () => {
      setMounted(true);
      setOpen(true);
    };
    globalThis.addEventListener(OPEN_PALETTE_EVENT, onOpen);
    return () => globalThis.removeEventListener(OPEN_PALETTE_EVENT, onOpen);
  }, []);

  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <CommandPaletteBody open={open} onClose={() => setOpen(false)} />
    </Suspense>
  );
}

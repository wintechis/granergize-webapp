# Granergize WebApp — UI style guide

A short, enforceable set of conventions for the app's look. The goal is a *calm*,
consistent surface: lean on the theme and a few primitives, avoid bespoke
per-component styling. Most rules here exist because the opposite drifted in and
made the UI feel "busy".

The single source of truth for visual values is **`src/theme.ts`** (MUI theme).
Components should pull from it, not hardcode.

---

## 1. Typography

The app deliberately uses a **narrow type scale**. MUI ships ~12 widely-spaced
text styles; left unconstrained they clash. The theme collapses everything into
**three visual tiers**, and components use a **small set of `variant` names**.

### Visual tiers (defined in `theme.ts`)
- **Heading** — weight 600, sizes 1.05–1.5rem (`h3 h4 h5 h6`, `subtitle1/2`)
- **Body** — weight 400, 0.95rem (`body1`)
- **Muted** — weight 400, 0.875 / 0.8rem (`body2`, `caption`)

### Which `variant` to use (the canonical set)
- **Page / top-of-card title** → `h5` (renders as 1.2rem 600)
- **Section / sub-section heading** → `h6` (renders as 1.05rem 600)
- **Normal body text** → `body1` (renders as 0.95rem)
- **Secondary / dense / helper text** → `body2` (renders as 0.875rem)
- **Fine print (hints, validation, metadata)** → `caption` (renders as 0.8rem)

That's it for app screens — **five variants**. Don't introduce `subtitle1/2`
(use `h6`) or `h3/h4` (use `h5`). The only exception is **`GuidePage.tsx`**, a
standalone printable document with its own cover-page typography (`h3/h4` are
allowed there).

### Hard rules
- **Never set `fontSize` or `fontWeight` inline** (`sx`/`style`) in a component.
  Use a `variant`. This is **lint-enforced** — `no-restricted-syntax` in
  `eslint.config.js` warns on inline font props in any `*.tsx`.
  - Genuine exceptions (icon glyph sizing, em-relative icon scaling) get an
    inline `// eslint-disable-next-line no-restricted-syntax -- <reason>`.
- Headings carry their weight from the variant — **don't add `fontWeight:"bold"`**.
- To change a size globally, edit the tier in `theme.ts`, not the call-sites.

---

## 2. Color

Palette lives in `theme.ts`; use semantic theme keys, not hex literals.
- `primary` `#0277bd` — actions, links, selected state (energy-infra blue)
- `secondary` `#388e3c` — sustainability / renewables accents
- `success` `#2e7d32` — "below average / good" energy indicators
- `warning` `#e65100`, `error` `#c62828`
- `background.default` `#f5f7fa` (cool grey), `background.paper` `#ffffff`

Rules:
- Reference via `color="text.secondary"`, `color="primary"`, `sx={{ color:
  "success.main" }}` — **don't inline hex** in components.
- Chart colors come from `src/constants/chartColors.ts` (incl. marker colors).
  Add new series colors there, not inline.

---

## 3. Surfaces & spacing

- **Boxed content uses `<Paper variant="outlined">`**, not a hand-rolled `<Box>`
  with `border`/`borderRadius`/`backgroundColor`. (`MuiCard` already defaults to
  `variant="outlined"` via the theme.) One surface language, theme-aware.
- **Spacing uses the theme unit** (8px) via shorthand: `p`, `px`, `py`, `mt`,
  `gap`, etc. Prefer small steps (`0.5`–`2`). Don't use raw `px` for layout
  spacing.
- **No magic-number viewport heights** (`calc(100vh - 216px)` & friends). Fill
  available space with flexbox: a column container is `display:flex;
  flexDirection:column`, fixed bars are `flexShrink:0`, the growing area is
  `flexGrow:1; minHeight:0`. See `pages/index.tsx` + `pages/Map.tsx` for the
  pattern.
- Prefer **semantic / plain HTML with minimal styling** over heavy MUI chrome
  where it reads cleanly (e.g. the energy-mix `<table>`, the footer). Lean toward
  fewer wrappers.

---

## 4. Dialogs

- Build the `onClose` with **`guardedDialogClose(close, { dirty, busy })`**
  (`src/components/dialogClose.ts`) for any dialog containing a form:
  - backdrop click never closes (prevents accidental data loss),
  - Escape confirms "Discard your changes?" when `dirty`,
  - closing is suppressed while `busy` (a save/upload is running).
- Explicit **Cancel / X** buttons call the real close routine directly.
- Width: `maxWidth="sm"` + `fullWidth` for forms (≈600px). Height is content-driven
  (MUI caps it and scrolls `DialogContent`); don't hardcode it.

---

## 5. Icons

- Size icons with the MUI `fontSize="small" | "inherit" | "large"` prop, or let
  them inherit. Sizing an icon glyph via `sx={{ fontSize }}` is the one place an
  inline font value is acceptable — annotate it with an eslint-disable + reason.

---

## 6. Where things live

- Theme (type scale, palette, component defaults): `src/theme.ts`
- Shared detail primitives (`DetailCard`, `DetailRow`, `SectionTitle`,
  `UriLink`, `RefLink`): `src/components/detail/DetailView.tsx`
- Dialog close guard: `src/components/dialogClose.ts`
- Chart / marker colors: `src/constants/chartColors.ts`
- Notifications: go through `NotificationContext` (`useNotification`), not ad-hoc
  alerts.
- Lint rules (incl. the typography guard): `eslint.config.js`

---

## 7. Adding UI — quick checklist

- [ ] Text uses one of the five `variant`s; no inline `fontSize`/`fontWeight`.
- [ ] Colors via theme keys / `chartColors.ts`; no hex literals.
- [ ] Boxed content is `<Paper variant="outlined">`; spacing via theme units.
- [ ] Heights via flexbox, not `calc(100vh - N)`.
- [ ] Form dialogs use `guardedDialogClose`.
- [ ] `deno run -A npm:eslint .` is clean (no new warnings).

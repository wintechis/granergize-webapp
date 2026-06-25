# UX overview

A coarse "surfaces + transitions" map of the app — one level above a full statechart.
Three layers: the app-shell **tabs** (each multi-guise finder carries its guise
sub-states — Buildings *list|map*, Observations *map|list|over-time|over-years* (the
energy cube), Aggregations *list|map|timeline*; Sharing/Agents/Meet are list-only),
the **detail surfaces** you drill into, and the modal **dialogs**.
Details-on-demand is two tiers — a **hover peek** (tooltip / hover card) vs **click →
open** (the detail page); the **⌘K palette** is a global overlay (navigate any tab ·
invoke the focused object's verbs).

Same model, three checked-in sources (the `.svg`/`.png` bitmaps are generated, gitignored):

- [`ux-overview.dot`](./ux-overview.dot) — clean forward-flow overview (Graphviz).
- [`ux-overview-returns.dot`](./ux-overview-returns.dot) — the same map **plus** the dialog
  save/cancel return-edges (the modal open↔close loop made explicit; busier).
- [`ux-overview.mmd`](./ux-overview.mmd) — the clean overview as a Mermaid `stateDiagram`
  (mirrors `ux-overview.dot`; paste into a ` ```mermaid ` fence to render on GitHub).

Render the bitmaps locally after editing a source:

```sh
dot -Tsvg ux-overview.dot          -o ux-overview.svg          # + ux-overview-returns.dot
dot -Tpng -Gdpi=120 ux-overview.dot -o ux-overview.png
mmdc -i ux-overview.mmd -o ux-overview.mmd.svg                 # mermaid-cli, if installed
```

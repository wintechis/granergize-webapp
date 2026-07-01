# Netztransparenz EEG settlement (linked-netztransparenz) ↔ our model

`linked-netztransparenz` (`~/projects/linked-netztransparenz`) publishes the German
TSOs' EEG-Jahresabrechnung — a plant's **actually-settled** renewable generation in kWh
per year. The app reads it through `src/services/netztransparenz.ts`
(`fetchPlantGenerationByYear` / `parsePlantSettlements`) and shows it as an annual
bar chart on the open observation detail. Shares the LDP/RDF patterns catalogued in
`mastr.md`; CORS-enabled, fetched directly. The app reaches it purely by **deref** of
`eeg/{number}`; the wrapper also exposes `/filter?plz=&source=&minkw=` (attribute
selection over the plant index — *not* keyword `/search`; see `README.md`
§"Capability vocabulary"), which the app does not use. No `/sparql`.

## Entities and vocabulary

- One per-plant document per EEG number, at `eeg/{number}` (`plantUrl`). The wrapper
  **reuses linked-mastr's `eeg/{number}` scheme**, so a MaStR unit's
  `mastr:EegMaStRNummer` dereferences straight here — the join is by EEG number, not by
  coordinates or a shared IRI.
- `vocab:strommengeKWh` (kWh) per settlement year. `dcterms:license` dl-de/by-2.0.

## Correspondence to our model

This is the **measured** counterpart to MaStR's *registered* figures: MaStR gives a
unit's installed `Bruttoleistung` (a capacity), netztransparenz gives the same plant's
realised kWh per year (a flow). It is observation-like annual energy, but it stays
**open context** — it never lands on a building's `<#pv>` system node; only the user's
own metered readings do (see `energy-model.md`). The app fetches it lazily, keyed off a
MaStR unit's EEG number, to annotate that open unit with its settlement history.

## Divergence

No spatial endpoint and no own geometry — it is **EEG-number-addressed only**, reached by
following `mastr:EegMaStRNummer` from a MaStR unit. A unit with no EEG number (e.g.
non-subsidised) has no settlement document, which degrades silently to "no generation
history".

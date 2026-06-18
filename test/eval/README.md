# test/eval/ — model evals

Measures a **model's** behaviour, so it calls a **real LLM endpoint** (unlike the
hermetic test tiers). Not run by `deno task test` or Playwright.

## intent-translation

Does the model translate natural language → app-intent JSON (`{name, params}`) for
the ⌘K paste-and-launch box?

- **Input / benchmark:** [`cases.json`](./cases.json) — array of `{ nl, expect, category, note? }`.
- **Gold answers:** the `expect` field (an intent name, an array of acceptable names,
  or `""` = "should decline").
- **Scoring:** cases whose expected verb is in the live catalog (`INTENTS`) are
  **scored** for name accuracy; the rest (`FindBuildings`, `Show…`, …) are **frontier**
  — reported, not scored — and flip to scored automatically as those cores land.

### Commands

```sh
# run the eval (loads .env.local for the key)
deno task eval:intent

# or pass the key inline (no file)
LLM_API_KEY=<key> deno run -A test/eval/intent-translation.eval.ts

# override endpoint / model (defaults: hub.nhr.fau.de/api/llmgw/v1, Qwen3.6-35B-A3B-FP8)
LLM_API_URI=<uri> LLM_MODEL=<model> deno task eval:intent
```

Key resolution: `LLM_API_KEY` / `LLM_API_URI` / `LLM_MODEL`, or the app's
`VITE_LLM_*` names — whichever is set (so one `.env.local` serves app + eval). Without
a real key the run warns and fails auth. Exit code is non-zero if any **scored** case
fails (frontier cases never fail the run).

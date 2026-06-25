# FAU NHR LLM gateway ↔ our model

The **FAU NHR LLM gateway** (`hub.nhr.fau.de/api/llmgw/v1`, `VITE_LLM_API_URI` /
`VITE_LLM_API_KEY` / `VITE_LLM_MODEL`) is the language-model backend the app calls
in `src/services/llm/intentTranslate.ts` to turn a natural-language query into a
structured app intent. An OpenAI-compatible chat API — **not RDF, not a data
source** — its own source id, distinct in kind from every other entry here.

## What it is

`POST /chat/completions` (Bearer auth), `response_format: json_object`, with a
**system prompt derived dynamically from the app's INTENTS catalog** so it can't
drift, and the user's free text as the user message. The reply's
`choices[0].message.content` is parsed into `{ name, params }` and handed to the
paste-and-launch / intent pipeline. Retries on transient failure; ~30 s timeout.

## Relation to our model

It is **machinery, not content**: it maps human language onto the *existing*
intent/command surface — it never produces RDF, building data, or observations,
and writes nothing to the Pod. It reads the intent catalog (app code), not Pod
data. Compare the deterministic, layout-aware import (`AddBuildingDialog`):
the LLM is the fallback for unstructured input, the catalog stays the schema.

## Provenance / notes

Hosted at FAU (NHR), so prompts stay within the university's gateway rather than a
public vendor. The browser-visible `VITE_LLM_API_KEY` default is a dev/test
placeholder, not a production secret — real keys go in the git-ignored env, and a
browser-exposed key is itself a constraint to keep in mind for any production use.

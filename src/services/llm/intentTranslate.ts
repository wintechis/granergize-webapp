/**
 * Natural-language → intent JSON, via an OpenAI-compatible chat API.
 *
 * This is the **front half** of the paste-and-launch pipeline
 * (`plan-intent-core.md` §10): the NL parser that *produces* a `{ name, params }`
 * for the launcher. It is NOT the launcher — it only translates; the resulting JSON
 * still flows through `parseLaunch`/`launch` (catalog-resolved, validated) exactly
 * like a pasted intent. So a wrong LLM guess is caught downstream, and the user
 * reviews the JSON before it fires.
 *
 * The system prompt is **derived from the catalog** (`INTENTS` + `INTENT_PARAMS`),
 * so it can never drift from the real verb/param set. The model is asked for a
 * single JSON object and nothing else (`response_format: json_object`).
 *
 * Config is env-overridable (`VITE_LLM_*`); the defaults target the FAU NHR
 * endpoint. NOTE: a browser-shipped `VITE_` key is visible to clients — fine for a
 * dev/research endpoint, not for a secret production key.
 */
import { INTENTS } from "../../intents/catalog.ts";
import { INTENT_PARAMS } from "../../intents/params.ts";
import { selectorFieldsSpec } from "../../intents/selector.ts";
import { trackedFetch } from "../../lib/networkActivity.ts";

// `import.meta.env` is Vite-injected in the app; under `deno test` it is undefined,
// so read it defensively (the defaults then apply).
const ENV = (import.meta as { env?: Record<string, string | undefined> }).env;
const API_URI = ENV?.VITE_LLM_API_URI ?? "https://hub.nhr.fau.de/api/llmgw/v1";
const API_KEY = ENV?.VITE_LLM_API_KEY ?? "foobarbaz";
const MODEL = ENV?.VITE_LLM_MODEL ?? "Qwen/Qwen3.6-35B-A3B-FP8";

/** Endpoint config — defaults to the env-resolved values; the eval injects its own. */
export interface LlmConfig {
  apiUri: string;
  apiKey: string;
  model: string;
  /** Sampling temperature; defaults to a rather-low 0.2 (see the request body). */
  temperature?: number;
  /** Send `response_format: json_object` (default true). gpt-oss must set false —
   * it emits malformed JSON under the constraint. */
  jsonMode?: boolean;
  /** Send `chat_template_kwargs:{enable_thinking:false}` (default true). Qwen-only —
   * Mistral-Medium 400s on it, so non-Qwen models set false. */
  disableThinking?: boolean;
}

/** The app's default config (from `VITE_LLM_*` / the built-in defaults). */
export const defaultLlmConfig = (): LlmConfig => ({
  apiUri: API_URI,
  apiKey: API_KEY,
  model: MODEL,
  temperature: 0.2,
});

/** A translation that could not be obtained or understood. `retriable` marks the
 * transient failures (timeout / unreachable) worth a single retry; a non-OK status,
 * empty or non-JSON completion is NOT retried (it won't fix itself). */
export class TranslateError extends Error {
  constructor(message: string, readonly retriable = false) {
    super(message);
    this.name = "TranslateError";
  }
}

/**
 * Render the catalog as a compact spec the model maps onto: one line per intent
 * (name, effect, entity) with its params (field, cardinality). Derived from the
 * live catalog so it stays in lockstep with the dispatchable verbs.
 */
export function buildIntentCatalogSpec(): string {
  const params = INTENT_PARAMS as Record<
    string,
    Record<string, { cardinality: string }>
  >;
  return INTENTS.map((e) => {
    const ps = params[e.name];
    const paramList = ps
      ? Object.entries(ps)
        .map(([field, spec]) => `${field}(${spec.cardinality})`)
        .join(", ")
      : "";
    const entity = e.entity ? `, entity=${e.entity}` : "";
    return `- ${e.name} [${e.effect}${entity}]${
      paramList ? ` — params: ${paramList}` : ""
    }`;
  }).join("\n");
}

/** The system prompt — instructions + the derived catalog spec. */
export function buildSystemPrompt(): string {
  return [
    "You translate a user's natural-language request into ONE app intent,",
    "expressed as a single JSON object: { \"name\": <intent name>, \"params\": { ... } }.",
    "",
    "Rules:",
    '- "name" MUST be exactly one of the intent names listed below.',
    "- Fill \"params\" from the request using the parameter names listed for that",
    "  intent; omit any param you cannot determine. Use [] / objects as the",
    "  cardinality implies (one = a single value, many = an array).",
    "- Identify entities by their IRI/WebID when the user gives one; otherwise put",
    "  the name the user said as a string and let the app resolve it.",
    "- Output ONLY the JSON object — no prose, no code fences, no explanation.",
    "- If no intent fits, output {\"name\": \"\", \"params\": {}}.",
    "",
    "Available intents (name [effect, entity] — params: field(cardinality)):",
    buildIntentCatalogSpec(),
    "",
    selectorFieldsSpec(),
  ].join("\n");
}

/** Minimal shape of the OpenAI-compatible chat-completions response we read. */
interface ChatCompletion {
  choices?: { message?: { content?: string } }[];
}

/** Injectable transport (defaults to the tracked fetch; tests pass a fake). */
export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Translate `text` to an intent-JSON string by calling the chat API. Returns the
 * model's raw JSON string (to be reviewed, then run through `parseLaunch`/`launch`).
 * Throws {@link TranslateError} on a transport/API failure or an empty completion.
 */
/** Default per-request timeout — a stalled endpoint must fail the call, never hang
 * the caller (a hung fetch once hung an entire sequential eval run). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Options for {@link translateToIntentJson}. */
export interface TranslateOptions {
  fetchImpl?: FetchLike;
  config?: LlmConfig;
  timeoutMs?: number;
  /** Extra attempts after the first, for transient (timeout/unreachable) failures.
   * Default 1 (so one retry). */
  retries?: number;
  /** Called before each retry — `(attempt, of)` (1-based) — so a UI can show
   * "retry 1/1". */
  onRetry?: (attempt: number, of: number) => void;
}

/** One attempt: the bounded fetch + parse. Throws a {@link TranslateError} whose
 * `retriable` flag marks the transient failures. */
async function attemptTranslate(
  text: string,
  fetchImpl: FetchLike,
  config: LlmConfig,
  timeoutMs: number,
): Promise<string> {
  // Base request. The two model-specific toggles default ON (tuned for Qwen, the
  // app model); other models need them off (per-model profiles — see the eval
  // sweep): Mistral-Medium 400s on `chat_template_kwargs`, and gpt-oss emits
  // malformed JSON under `response_format` (both confirmed by probe).
  const reqBody: Record<string, unknown> = {
    model: config.model,
    // Rather-low temperature (default 0.2): near-deterministic for a structured
    // translation, without the occasional greedy-loop pathology of an exact 0.
    temperature: config.temperature ?? 0.2,
    // An intent JSON is tiny (<~150 tokens). Cap output as a backstop.
    max_tokens: 512,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: text },
    ],
  };
  if (config.disableThinking ?? true) {
    // DISABLE chain-of-thought — this is a constrained translation, not reasoning.
    // With thinking ON, some observation phrasings sent Qwen into a 2000+-token
    // reasoning runaway that consumed the whole budget and never emitted the answer
    // (content:null, finish:length → our timeout). `enable_thinking:false` (vLLM
    // chat-template kwarg) → ~10× faster, no runaways, finish:stop.
    reqBody.chat_template_kwargs = { enable_thinking: false };
  }
  if (config.jsonMode ?? true) {
    reqBody.response_format = { type: "json_object" };
  }
  let res: Response;
  try {
    res = await fetchImpl(`${config.apiUri}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      // Bound the request so a stalled endpoint rejects instead of hanging forever.
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(reqBody),
    });
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new TranslateError(`Model request timed out after ${timeoutMs}ms`, true);
    }
    throw new TranslateError(`Could not reach the model: ${err.message}`, true);
  }
  if (!res.ok) {
    throw new TranslateError(`Model request failed (${res.status} ${res.statusText})`);
  }
  let body: ChatCompletion;
  try {
    body = await res.json() as ChatCompletion;
  } catch {
    throw new TranslateError("Model returned a non-JSON response");
  }
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new TranslateError("Model returned an empty completion");
  }
  return content;
}

export async function translateToIntentJson(
  text: string,
  opts: TranslateOptions = {},
): Promise<string> {
  const {
    fetchImpl = trackedFetch,
    config = defaultLlmConfig(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = 1,
    onRetry,
  } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptTranslate(text, fetchImpl, config, timeoutMs);
    } catch (e) {
      const retriable = e instanceof TranslateError && e.retriable;
      if (retriable && attempt < retries) {
        onRetry?.(attempt + 1, retries);
        continue;
      }
      throw e;
    }
  }
}

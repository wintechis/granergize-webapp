# `src/intents/` — React-free intent cores

The **core** below the hook. See
[`../../explore/explore-intent-registry.md`](../../explore/explore-intent-registry.md)
§"Half the abstraction, React-bound" (the line this layer draws) and §"Actions"
(the effect-discriminated result channel), and
[`../../plans/plan-intent-core.md`](../../plans/plan-intent-core.md) §1.

## The core/adapter split

An intent's implementation splits in two:

- **The core** (here) — a plain async function
  `<name>Core(session, params) → Promise<Outcome | Result>` holding exactly the
  Pod-request composition. It **takes the `Session` as an argument** (never calls
  `getSession()`), imports **no React and no React Query**, and returns a typed
  result. It is the single implementation, callable headless — a palette, a deep
  link, an LLM tool, the bench seeder, or a Tier-2 runner can invoke it with no
  component tree (proven by the Tier-1 `*.test.ts` here, which call the core with
  a fake offline-fixture session).

- **The adapter** (the hook in `src/hooks/mutations.ts`) — a thin `useMutation`
  whose `mutationFn` calls the core with `getSession()`, keeping ONLY the parts
  that mean something where a query cache exists: busy (`isPending`), the central
  error toast (`meta.action`), and the cache invalidation (`onSettled`). UI
  behaviour is unchanged.

## CQS at the type level (§"The in-code catalog")

The result channel is discriminated on effect:

- A **write** core returns an **outcome** — settled, or a small per-item tally
  (e.g. `{ recipientsShared }`) — **never a value**. No caller consumes a
  mutation's return value; the effect is on the Pod, observed through the
  adapter's invalidations.
- A **read** core returns its **value** (the audit report, the archive blob).
  The returned value is a read-intent's whole point.

The full outcome taxonomy (abort-as-outcome, whole-cache invalidation, the
boundary cases) lands in later steps; Step 1 establishes only the shape.

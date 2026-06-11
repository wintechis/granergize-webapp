# Plan: dialog writes through the mutation layer

## Problem

Ten write sites — the Add/Edit building dialogs, the energy-year dialog, the
share-building and share-view dialogs, the files dialog, the create-view dialog,
the organisation dialog, and the standalone view page's share action — perform
their Pod writes by hand instead of through a mutation hook. Each repeats the
same dance: a local `busy`/`saving` boolean, `try`/`catch` around a direct
service call, `showNotification(formatError(…))` (or a bespoke message) in the
catch, and either a manual `invalidateQueries` or a callback to the parent,
which invalidates on the dialog's behalf.

What this costs:

- **Error classification is bypassed.** `QueryProvider` routes every
  hook-mutation error through `classifyQueryError`: `SessionExpiredError` → a
  re-login warning, `ConflictError` → "This changed elsewhere — please reload
  and try again." A hand-rolled catch flattens both into a generic red
  `"Failed to {action}: {raw message}"` — a conflict shows the internal
  "Conflicting concurrent edit to {url}" text, a session expiry looks like a
  data error. The classification exists; the dialogs just never reach it.
- **The invalidation contract is scattered.** Which keys a write refreshes is
  decided partly in the dialog, partly in the parent's `onSaved`-style callback
  (`ManagePage` owns several dialogs' invalidations). The contract drifts: a
  dialog reused from a second place silently loses its refetch.
- **The busy state is duplicated** per dialog as local state, instead of being
  the mutation's `isPending`.
- **Toast wording drifts.** Several sites don't use `formatError` at all
  (raw `error.message` toasts, bespoke inline strings).

The repair direction is not a new abstraction: `mutations.ts` already holds
seventeen intent-named hooks (delete building, revoke access, room operations,
contacts…) that do this right. The work is migrating the remaining writes onto
that pattern, plus one small mechanism the pattern is missing — the **action
label** for centrally-produced error toasts.

## Design

### One hook per user intent

Every user-intent Pod write gets a named hook in `mutations.ts` wrapping the
existing service function(s) as its `mutationFn` — the service layer
(`readModifyWrite` locking, event-first ordering) is untouched. The hook owns
its invalidations in `onSettled`. Dialogs then hold no write plumbing:

- *busy* is the mutation's `isPending`, fed to the Modal `busy` prop and the
  action button's `disabled` (loading policy unchanged).
- *errors* are central: the dialog drops its `try`/`catch` +
  `showNotification`; `QueryProvider`'s `MutationCache` produces the toast with
  the right severity per error class.
- *success side effects* (close the dialog, reset the form, select the new
  building) stay at the call site via `mutateAsync` / per-call `onSuccess` —
  they are UI, not data-layer.
- *parent callbacks* (`onBuildingAdded`, `onViewCreated`, `onChange`…) shrink
  to pure UI concerns; the invalidation halves of `ManagePage`'s callbacks are
  deleted.

### The action label (`meta.action`)

The notifications convention requires error toasts shaped
`"Failed to {action}: {detail}"` (`formatError`). Central routing needs the
action name, so each hook declares it as React Query mutation `meta`:

    useMutation({ mutationFn: …, meta: { action: "update the building" } })

`MutationCache.onError(error, _vars, _ctx, mutation)` reads
`mutation.meta?.action` and wraps **generic** errors with
`formatError(action, error)`. `SessionExpiredError` and `ConflictError` keep
their classified messages untouched — those are complete sentences about an
app-level state, not about the failed action. `classifyQueryError` stays pure
and gains the optional action parameter (queries pass none; behaviour
unchanged), so the mapping remains unit-testable without React.

### Inline errors (the Alert carve-out)

The two share dialogs render the failure *inline* in their confirm step (the
documented `<Alert>` carve-out: persistent, contextual feedback a snackbar
can't provide). They keep that, and must not ALSO toast. Hooks whose canonical
surface is inline declare `meta: { silent: true }`; the cache skips the toast
and the dialog renders `mutation.error` through the same `classifyQueryError`
so the wording can't fork. The same intent used from a toast-appropriate
context (the standalone view page's share action) instantiates the hook
without `silent`.

### What deliberately stays in the components

- **Confirmation UI** — native `confirm` popups and the two-step confirm flows
  are pre-write interaction, not write plumbing.
- **The energy-year dialog's stays-open behaviour** and its local "Stored
  years" read-back list (it updates the list optimistically, then the hook's
  invalidation refetches; both survive as-is).
- **The files dialog's local item list** — same shape.
- **The add dialog's progress + cancel** — the abort signal and the
  `onProgress` callback travel inside the mutation *variables*; the progress
  overlay and the cancel button (which stays enabled while busy) are dialog UI.
  Partial success on abort keeps its current semantics: fully-written buildings
  are kept and reported.
- **Geocoding** — an external read, not a Pod write; out of scope.

### Hooks to add

Intent-named, each with its `meta.action` and invalidation set:

- `useUploadBuildings` — the add flow (per-building: energy series first,
  building file last — commit-last ordering preserved), variables carry
  `{ signal, onProgress }`; invalidates the building-data set (the
  `useInvalidateBuildingData` keys) + contacts (agent auto-remember).
- `useUpdateBuilding` — `updateBuilding` + agent auto-remember; invalidates the
  building-data set + contacts.
- `useWriteEnergyYear` / `useDeleteEnergyYear` — invalidate the building-data
  set.
- `useShareBuilding` — per-recipient `shareBuildingData` (loop at the call
  site, so per-recipient failure keeps its inline reporting); invalidates
  `sharedOutLog`; silent (inline Alert).
- `useShareViewSnapshot` — `shareAggregatedView`; invalidates `sharedOutLog`;
  silent in the share-view dialog, toasting on the standalone view page.
- `useUploadAttachment` / `useDeleteAttachment` / `useSetEnergyCertificate` —
  invalidate `buildings` (attachments render from building data).
- `useCreateView` — `createViewDefinition` then `computeAndStoreSnapshot` in
  one `mutationFn` (one user intent, two steps); invalidates
  `viewDefinitions`.
- `useSaveOrganization` — `saveOrganization` (+ conditional logo upload) in one
  `mutationFn`; calls `invalidateProfile` and invalidates `agent`/`agentLogo`.

`useInvalidateBuildingData` remains as the shared invalidation set the
building-write hooks call in `onSettled`; its "the dialog owns the write"
caveat comment retires.

## Order of work

1. **Infrastructure**: action-aware classification (`classifyQueryError` +
   optional action), `MutationCache` wiring for `meta.action`/`meta.silent`,
   meta typing; pure tests for the classification and a cache-level test that
   the meta is honoured.
2. **Single-write dialogs** (mechanical): edit building, organisation,
   energy year (save + delete), files (upload/delete/certificate), create
   view, the view page's share action.
3. **Inline-error share dialogs**: share building, share view — silent hooks +
   `mutation.error` rendered through the classifier.
4. **The add dialog** last (abort, progress, multi-building partial success —
   the only structurally interesting migration).
5. **Slim the parents**: delete the invalidation halves of `ManagePage`'s
   dialog callbacks; verify no dialog imports `useQueryClient` for write
   purposes anymore.

## Tests

- `queryErrors`: generic error + action → `"Failed to {action}: {detail}"`;
  `ConflictError`/`SessionExpiredError` ignore the action; no action → raw
  message (today's behaviour).
- Cache wiring: a `MutationCache` with the new `onError` receives a mutation
  carrying `meta.action` / `meta.silent` and produces (or suppresses) the
  expected notification — testable with a plain `QueryClient`, no DOM.
- Per-hook invalidation pins (the `queries.test.ts` pattern — "invalidates X,
  not Y") for the hooks with non-obvious sets: write/delete energy year,
  share building (sharedOutLog only), create view, save organisation.
- The existing Tier-3 specs cover the dialogs' UI behaviour (energy-entry,
  share-building, share-view, materialised-views, organisation, excel-import);
  they assert outcomes, not toasts, so the migration should be invisible to
  them.

## Out of scope / follow-ups

- An ESLint rule banning service-write imports from `src/components/` (the
  structural enforcement of "dialogs never write directly") — worth doing once
  the migration proves the shape, not before.
- Converting the dialogs' local read-back lists (stored years, files) into
  queries of their own. Resolved on the read-side pass that followed: the
  dialogs' *log-folding* reads became query derivations (the share-view and
  create-view contributor/member loads — see the queries in `queries.ts`),
  while the energy-year stored-years list deliberately stays local: it is
  updated optimistically on save/delete (the stays-open behaviour preserved
  above), which a query's invalidate-and-refetch cycle would regress. The
  organisation dialog's prefill also stays: it reads the per-session-cached
  profile and seeds form state the dialog itself overwrites.

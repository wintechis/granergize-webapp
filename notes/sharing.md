# Bilateral Sharing

Direct WebID-to-WebID sharing of a **building** or **aggregated view**, Pod-to-Pod. A
share grants the recipient read access and notifies them; the data stays in the owner's
Pod (no copy).

Companion to [`storage-model.md`](./storage-model.md) (the event-log design),
[`room.md`](./room.md) (rooms as a share-by-role directory), and
[`views.md`](./views.md) (the view snapshots that get shared).

## Model — two append-only event logs

Sharing state isn't a registry that gets rewritten; it's two append-only **event logs**
per Pod, each an LDP container under `granergize/`:

- `shared-out/` — sharing **you performed** (grants + revocations you issued).
- `shared-in/` — sharing **received** (`drainInbox` archives each inbox message here).

Every event is its own resource (POST → the server mints the child URI, so concurrent
appends never clobber). One Turtle shape serves all three places an event appears — the
recipient's inbox message, the sharer's `shared-out/`, and the recipient's `shared-in/`.
Current state = **fold** the log (`foldSharingLog`): group by `(grantee, resource)`,
keep the latest by `prov:generatedAtTime`, and emit the pair only if that latest event
is a grant (a later revocation drops it; on an exact-timestamp tie the revocation wins,
least-privilege). The WAC `.acl` stays the enforcement truth — the logs are the app's
**record**, and the only way a recipient learns of an inbound grant (it lives in the
sharer's `.acl`, reachable only via the inbox).

## Flow

Owner, three writes:

1. **Grant ACL** — `acl:Read` for the recipient WebID on the resource's `.acl`.
2. **Notify** — POST a grant event to the recipient's inbox (`ldp:inbox` from their
   WebID profile).
3. **Record** — append a grant event to the owner's `shared-out/`.

Recipient — `drainInbox` lists the inbox and, per message: parse its sharing event(s),
append each to the user's `shared-in/` log, then delete the message. "Shared with me,
now" is the fold of `shared-in/`; a missed revocation self-heals because a building whose
grant was withdrawn 403s on load and is pruned. A shared building's provenance comes from
the shared building file's own PROV attribution (role sourced from the sharer's WebID
profile `org:role`).

## Event Turtle — `buildSharingEventTurtle`

The event resource **is** the event (subject `<>`), and the shape is **flat** (no nested
blank nodes):

```turtle
<> a interop:AccessGrant ;                  # or interop:AccessRevocation
   prov:wasAssociatedWith <owner> ;         # the sharer
   interop:grantee        <recipient> ;
   interop:forResource    <resource> ;
   interop:accessMode     acl:Read ;        # grant only
   gran:kind              gran:Building ;    # grant only: Building | View (routing hint)
   interop:includesEnergyData "true"^^xsd:boolean ;   # grant only, optional
   prov:generatedAtTime   "…"^^xsd:dateTime .
```

A revocation is `a interop:AccessRevocation` with the same `(grantee, resource)` and a
later time, and no `accessMode`/`kind`/`includesEnergyData`.

## Building — `shareBuildingData(buildingUri, webId, session, options)`

`grantReadAccess` always grants the static building file; if `includeEnergyData`, also
each `gran:hasEnergyDataset` resource (annual file / series descriptor), plus — for a
sub-hourly series — its daily-files container with `acl:default` (dispatched on the
dataset's declared granularity, not a role). Then notify + record. The `role` option is
deprecated/ignored — provenance no longer travels with the share.

## Revoke — `revokeAccess(buildingUri, webId, session)`

Append a revocation to `shared-out/`, remove the ACL authorization (building + any energy
targets), then `notifyAccessRevoked` POSTs a revocation event to the recipient's inbox so
their next `drainInbox` folds it out of `shared-in/`. Notification is best-effort — the
revocation succeeds even if it fails.

## Aggregated views — `shareAggregatedView(snapshotUrl, viewId, webId, session)`

Same flow on the computed **snapshot only** (recipient sees aggregate values, not the
source buildings); the grant event carries `gran:kind gran:View`. Recorded in
`shared-out/`; the viewId is recoverable from the snapshot URI
(`views/snapshots/<viewId>.ttl`), so it isn't stored separately. The view model itself
(definition vs. snapshot, computation) is owned by [`views.md`](./views.md).

Views have a **recipient side** too (previously view sharing was sender-only):

- `getReceivedViews` folds `shared-in/` for `gran:kind gran:View`, surfaced in a "Views
  shared with you" section on the Share tab and rendered via `loadComputedSnapshot`.
- `getSharedViews` folds `shared-out/` for the sender's "shared with" list.
- `revokeViewAccess` logs a revocation, withdraws the snapshot's `.acl`, and notifies the
  recipient (resource-neutral `notifyAccessRevoked`) so the view drops off their "Views
  shared with you" on their next inbox drain.
- **Deleting** a shared view first calls `revokeAllViewRecipients`, which loops every
  current recipient through `revokeViewAccess` — so the snapshot doesn't linger on anyone's
  list after it's gone.

## Local visibility — `toggleBuildingVisibility(buildingUri, session)`

Recipient hides a shared building via `gran:hiddenBuilding` in `prefs.ttl`
(`toggleHiddenBuilding`); owner unaffected. `getSharedWithMe` reads the same prefs to mark
each entry visible/hidden.

## Resources (`…/granergize/`)

The three sharing resources — `shared-out/` (grants/revocations you issued),
`shared-in/` (events archived from your inbox), and `prefs.ttl` (local
`gran:hiddenBuilding` entries) — sit under `granergize/`; see
[data-layout.md](data-layout.md) for the full Pod tree.

## Relationship to data rooms

Sharing is **independent of rooms** — you can share with any WebID, and a room grants no
access on its own. A room ([room.md](room.md)) is only a **recipient directory**:
`getMembersByRole(role)` resolves a role to WebIDs, and "share by role" loops them through
the bilateral grant above. Access is always the per-resource ACL grant. (Receiving a
role-targeted share requires room membership with that role, so you're discoverable; a
direct share needs nothing room-related.)

## Vocabularies

- **interop** (`http://www.w3.org/ns/solid/interop#`) — `AccessGrant`,
  `AccessRevocation`, `grantee`, `forResource`, `accessMode`, `includesEnergyData`.
- **prov** — `prov:wasAssociatedWith` (the sharer) and `prov:generatedAtTime` (event
  time) on each event; `prov:qualifiedAttribution` / `prov:agent` / `prov:hadRole` carry
  a building's provenance in the building file.
- **acl** — `acl:Read` / `acl:default` on `.acl` resources.
- **ldp** — `ldp:inbox`, `ldp:contains`.
- **gran** — `gran:kind` (`gran:Building` | `gran:View`, the event routing hint) and
  `gran:hiddenBuilding` (local visibility, in `prefs.ttl`).

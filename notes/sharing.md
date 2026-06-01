# Bilateral Sharing

Direct WebID-to-WebID sharing of a **building** or **aggregated view**, Pod-to-Pod. A
share grants the recipient read access to the resource and notifies them; the data
stays in the owner's Pod (no copy).

Code: [`share.ts`](src/services/interop/share.ts) (grants + notifications),
[`sharingManager.ts`](src/services/interop/sharingManager.ts) (registries, revoke,
visibility, views), [`inbox.ts`](src/services/interop/inbox.ts) (recipient side).

## Flow

Owner, three writes:

1. **Grant ACL** — `acl:Read` for the recipient WebID on the resource's `.acl`.
2. **Notify** — POST an `interop:AccessGrant` to the recipient's inbox (`ldp:inbox`
   from their WebID profile).
3. **Record** — append to the owner's `sharingRegistry.ttl`.

Recipient — `readInbox` lists the inbox and, per message: `interop:AccessGrant` → add
`forResource` (+ `gran:dataSourceRole`) to `dataSources.ttl`; `interop:AccessRevocation`
→ remove it; then delete the message. The next load (`TurtleParsingService`) reads
`dataSources.ttl`, so the shared resource appears.

## Building — `shareBuildingData(buildingUri, webId, session, options)`

`grantReadAccess` grants the static building file always; if `includeEnergyData`, also
the energy file (`dummy`/`investor`) or the parent container with `acl:default`
(`user`-role daily files). Then notify + record. Grant message:

```turtle
<#grant…> a interop:AccessGrant ;
    interop:grantedBy <owner> ; interop:grantedAt "…"^^xsd:dateTime ;
    interop:grantee <recipient> ; interop:includesEnergyData "true"^^xsd:boolean ;
    gran:dataSourceRole <gran:…Role> ;                       # optional
    interop:hasDataGrant [ a interop:DataGrant ;
        interop:forResource <building> ; interop:accessMode acl:Read ] .
```

## Revoke — `revokeAccess(buildingUri, webId, session)`

Remove the ACL authorization, delete from `sharingRegistry.ttl`, POST an
`interop:AccessRevocation` to the recipient (their `readInbox` drops it from
`dataSources.ttl`).

## Aggregated views — `shareAggregatedView(snapshotUrl, viewId, webId, session)`

Same flow on the computed **snapshot only** (recipient sees aggregate values, not the
source buildings); recorded in `viewSharingRegistry.ttl`; `revokeViewAccess` to revoke.

## Local visibility — `toggleBuildingVisibility(buildingUri, session)`

Recipient hides a building shared with them via `hiddenBuildings.ttl`; owner unaffected.

## Registries (`…/profile/granergize/`)

- `sharingRegistry.ttl` — owner; buildings shared out (+ recipients).
- `viewSharingRegistry.ttl` — owner; views shared out.
- `dataSources.ttl` — recipient; buildings shared **with** you (+ role) — loaded as sources.
- `hiddenBuildings.ttl` — recipient; shared buildings hidden locally.

## Relationship to data rooms

Sharing is **independent of rooms** — you can share with any WebID without either party
being in a room, and a data room grants no access on its own. A room ([room.md](room.md))
is only a **recipient directory**: `getMembersByRole(role)` resolves a role to WebIDs,
and "share by role" loops them through the bilateral grant above. Access is always the
per-resource ACL grant. (To *receive* a role-targeted share you must be a room member
with that role, so you're discoverable; a *direct* share needs nothing room-related.)

## Vocabularies

- **interop** (`http://www.w3.org/ns/solid/interop#`) — `AccessGrant`,
  `AccessRevocation`, `grantedBy`/`grantedAt`/`grantee`, `hasDataGrant`, `forResource`,
  `accessMode`, `includesEnergyData`.
- **acl** — `acl:Read` / `acl:default` on `.acl` resources.
- **ldp** — `ldp:inbox`, `ldp:contains`.
- **gran** — `gran:dataSourceRole` (role carried with a shared building).

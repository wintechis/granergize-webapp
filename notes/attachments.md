# Building file attachments

Arbitrary files (PDF / DOCX / JPG / anything) attached to a building, shared
automatically with whoever the building is shared with. The energy certificate is
modelled as one of these files. Companion to [`sharing.md`](./sharing.md) (the building
share that carries the files) and [`data-layout.md`](./data-layout.md) (where they sit).

## Storage

- Per-building container: `<storageRoot>granergize/buildings/<id>/files/<filename>`
  (next to the per-building energy subfolder; building discovery skips
  `buildings/<id>/` subcontainers). Path helper: `filesContainerFor()` in
  `attachmentManager.ts`, shared by the uploader and the share flow.
- Per-building (not a shared folder) is deliberate: one `acl:default` grant on the
  container covers every file in it — including future uploads — and can't leak
  other buildings' files.
- The legacy shared `buildings/certificates/<id>_…pdf` folder is **not** migrated.
  Existing certs there still resolve via their triple; sharing grants them via a
  file-IRI fallback. New cert uploads land in `files/`.

## RDF model (file IRI as subject — no blank node)

```turtle
<#building> bldg:hasAttachment <…/files/report.pdf> .
<…/files/report.pdf> a schema:MediaObject ;
   schema:name "report.pdf" ; schema:encodingFormat "application/pdf" ;
   schema:contentSize 124533 ; dcterms:created "2026-…"^^xsd:dateTime .
# the energy certificate is one such file, additionally flagged:
<#building> bldg:hasEnergyCertificate <…/files/<id>_energy_certificate.pdf> .
```

The file IRI is the metadata subject (not a blank node), so the metadata isn't
affected by `TurtleParsingService`'s per-source blank-node scoping, and a file is
removed by dropping all triples with that subject. Constants in `vocabularies.ts`
(`GRAN_HAS_ATTACHMENT`, `SCHEMA_*`, `DCTERMS_CREATED`).

## Write path — `services/attachments/attachmentManager.ts`

Binaries can't go through the string-field building serializer, so this mirrors the
old `certificateUploader` but on the race-safe `readModifyWrite` (`podWrite.ts`):

- `uploadAttachment` — `ensureContainer` the `<id>/` then `files/` container; PUT the
  binary (de-duped filename) with its `file.type`; add the link + metadata.
- `deleteAttachment` — DELETE the binary; drop the link + metadata (and clear the
  cert flag if it pointed there).
- `setEnergyCertificate` — set/clear `bldg:hasEnergyCertificate` (one file at a time).
- `fetchAttachmentBlob` — authed `session.fetch` → `Blob` (works for recipients too).

Parsing (`buildingParser.ts`) reads `bldg:hasAttachment` + metadata into
`BuildingType.attachments` (`AttachmentRef[]`), flags the certificate, and
synthesizes an entry for a legacy cert that has only `bldg:hasEnergyCertificate`.
`updateBuilding` already preserves untouched triples, so building edits leave files
intact — no change there.

## Sharing

- `share.ts shareBuildingData` provisions + grants the `files/` container with
  `acl:default`; a legacy cert outside `files/` gets a file-IRI grant. This also
  fixes the long-standing gap where a shared building's certificate 403'd.
- `sharingManager.ts revokeAccess` withdraws the container (+ legacy cert) via
  `removeFromACL` (idempotent), alongside the building TTL and energy datasets.
- Recipients fetch binaries on demand with their own session; no recipient-side
  change was needed.

## UI

- `FilesDialog` (in `BuildingDialogs.tsx`, replaces the energy-certificate dialog):
  multi-file upload, download, delete, mark-as-certificate; soft-cap **warnings**
  (~25 MB/file, ~20 files) — not hard limits. Opened from the Manage row **Files**
  action.
- `components/detail/FilesSection.tsx`: read-only list + authenticated blob
  download (the recipient's own session via `getSession()`, so it works cross-Pod).
  Used in the building detail pane AND on the **Share tab** — each shared-building
  row lazily loads the building (`SharedBuildingFiles` in `SharePage.tsx`) and
  renders the section, so a recipient downloads shared files directly from there.

## Out of scope / deferred

Inline image/PDF previews; attachment versioning; attachments on shared **views**;
removing the legacy `buildings/certificates/` folder. **Contributor uploads**
(others adding files, not just the owner) are deferred — they'd need an append-only
contributions container (the data-room/inbox `acl:Append` + list-to-discover
pattern), since others can't write the owner's single-writer building TTL.

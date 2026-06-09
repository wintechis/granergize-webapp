# Granergize vocabularies — repo is the source of truth

The app models Pod data with four Granergize vocabularies. Their IRIs are absolute
URLs on the FAU Solid Pod, but **the editable source of truth is now these files in
the repo** — the published documents are a deploy target, not the master copy. The
app itself only *references* these IRIs (as constants in
`src/services/rdf/vocabularies.ts`); it never fetches these documents at runtime.

## Namespace → file

| Namespace constant | Published IRI (PUT target) | Repo file |
| --- | --- | --- |
| `GRAN_NS` | `https://solid.ti.rw.fau.de/private/granergize/vocab.ttl#` | `vocab/vocab.ttl` |
| `INVESTOR_NS` | `…/investor-vocab.ttl#` | `vocab/investor-vocab.ttl` |
| `BENCH_NS` | `…/benchmark-vocab.ttl#` | `vocab/benchmark-vocab.ttl` |
| `USERVOC_NS` | `…/user-vocab.ttl#` | `vocab/user-vocab.ttl` |

## How these were created

- `vocab.ttl` was **seeded from the document currently published** at its IRI, then
  evolved in-repo: two bugs fixed (a duplicate `rdfs:` prefix and `:investor`'s range,
  which read `rdfs:Raumwärme rec:Agent` → now `rdfs:range rec:Agent`), and an
  "Added in-repo" section appended with the terms the app reads/writes that the
  published document was missing (the energy-dataset model, attachments, geocode
  precision, prefs, bookmarks, views, company kinds).
- `investor-vocab.ttl`, `benchmark-vocab.ttl`, `user-vocab.ttl` had **no published
  document** (their IRIs 404), so they are authored here from the terms the app uses.

## Keeping in sync with the code

`src/services/rdf/vocab.test.ts` parses these files and asserts that every term the
app references (the building field-schema predicates + their object-property ranges,
and the controlled-vocabulary instances) is defined here. Add a term to the code and
the test fails until it's defined in the matching file — so the repo vocab can't
silently drift from what the app writes.

## Publishing to the Pod

A `PUT` replaces the whole resource, so publish the entire file (these are the
master copy — no manual merge needed):

```sh
# Authenticate to the Pod first (the files live under a private/ container).
curl -X PUT -H "Content-Type: text/turtle" \
  --data-binary @vocab/investor-vocab.ttl \
  https://solid.ti.rw.fau.de/private/granergize/investor-vocab.ttl
```

(repeat per file; supply the Pod's auth as your setup requires). These documents are
deliberately **not** copied into the app's `dist/` build: they're served from the FAU
Pod at their canonical IRIs, a different origin than the app's deploy host.

# Setup

For running the app see `README.md` (Deno: `deno install`, `deno task dev`).

## Credentials env file (data room admin scripts)

The data room admin scripts (uploading the SIOC member directory to the
provider Pod, verifying read access) authenticate against Community Solid
Server accounts on `solidcommunity.net`.

Keep credentials in a single `KEY=VALUE` file **outside this repo** (so it can
never be committed), readable only by you:

```
~/granergize-creds.env      # chmod 600

CSS_EMAIL=...               # provider (homer) account email
CSS_PASSWORD=...
USER2_EMAIL=...             # optional: a second account, for read-access checks
USER2_PASSWORD=...
```

Pass the path via the `CREDS_FILE` env var. The scripts read the file directly
(each value is taken verbatim after the first `=`, so passwords may contain
`% # & !` etc.) and never place secrets on the command line:

```
CREDS_FILE=~/granergize-creds.env node verify.mjs
```

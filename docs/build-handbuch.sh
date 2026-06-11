#!/usr/bin/env bash
#
# Build the Praxishandbuch from its single Markdown source (docs/handbuch.md)
# into PDF (for end users) and DOCX (so non-technical colleagues can take over
# edits in Word). Both land in public/ so they ship with the app and can be
# linked from the login screen.
#
#   deno task handbuch        # this script: text → PDF/DOCX (fast, pandoc only)
#   deno task handbuch:figures # recapture docs/figures/*.png (Playwright support run)
#   deno task handbuch:full    # figures, then the build — a fully fresh handbuch
#
# This script does NOT capture screenshots; it embeds whatever PNGs are already in
# docs/figures/. Those app screenshots are recaptured by the `support` Playwright
# project (test/e2e/support/screenshots.spec.ts) — run `handbuch:figures` after a
# UI change, or `handbuch:full` to refresh figures and rebuild in one step.
#
# Requires pandoc and (for the PDF) a LaTeX engine (xelatex).
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="docs/handbuch.md"
OUT_PDF="public/granergize-handbuch.pdf"
OUT_DOCX="public/granergize-handbuch.docx"

# Stamp the title page with the app version the handbuch describes: the short
# commit hash, marked "+" when the working tree has uncommitted changes. The
# month/year stays authored in the Markdown frontmatter; the version is
# appended at build time (command-line metadata overrides the frontmatter), so
# it can never go stale in the source.
VERSION="$(git describe --always --dirty=+ 2>/dev/null || echo unbekannt)"
DATE_LINE="$(sed -n 's/^date: *"\(.*\)"$/\1/p' "$SRC")"

# Image paths in the Markdown are repo-root-relative (docs/figures/*.png).
COMMON=(--resource-path=.:docs --metadata=date:"${DATE_LINE} · Version ${VERSION}")

echo "→ $OUT_DOCX"
pandoc "$SRC" "${COMMON[@]}" -o "$OUT_DOCX"

echo "→ $OUT_PDF"
pandoc "$SRC" "${COMMON[@]}" --pdf-engine=xelatex -o "$OUT_PDF"

echo "Done."

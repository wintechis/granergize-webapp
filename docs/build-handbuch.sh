#!/usr/bin/env bash
#
# Build the Praxishandbuch from its single Markdown source (docs/handbuch.md)
# into PDF (for end users) and DOCX (so non-technical colleagues can take over
# edits in Word). Both land in public/ so they ship with the app and can be
# linked from the login screen.
#
#   deno task handbuch        # or: bash docs/build-handbuch.sh
#
# Requires pandoc and (for the PDF) a LaTeX engine (xelatex). The screenshots
# referenced by the handbuch live in docs/figures/ and are produced by
# e2e/screenshots.spec.ts.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="docs/handbuch.md"
OUT_PDF="public/granergize-handbuch.pdf"
OUT_DOCX="public/granergize-handbuch.docx"

# Image paths in the Markdown are repo-root-relative (docs/figures/*.png).
COMMON=(--resource-path=.:docs)

echo "→ $OUT_DOCX"
pandoc "$SRC" "${COMMON[@]}" -o "$OUT_DOCX"

echo "→ $OUT_PDF"
pandoc "$SRC" "${COMMON[@]}" --pdf-engine=xelatex -o "$OUT_PDF"

echo "Done."

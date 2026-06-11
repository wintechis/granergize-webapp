#!/usr/bin/env bash
#
# Render the TikZ-sourced conceptual diagrams in this directory to the PNGs
# the handbuch embeds (docs/figures/*.png). Requires pdflatex (TikZ,
# fontawesome5) and pdftoppm. The app screenshots are NOT built here — see
# ../README.md.
set -euo pipefail
cd "$(dirname "$0")"

for src in *.tex; do
  name="${src%.tex}"
  pdflatex -interaction=batchmode "$src" >/dev/null
  # ~150 dpi yields the recommended ~1200–1500px width (see ../README.md).
  pdftoppm -png -r 150 -singlefile "$name.pdf" "../$name"
  rm -f "$name.aux" "$name.log" "$name.pdf"
  echo "→ ../$name.png"
done

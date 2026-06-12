#!/usr/bin/env bash
#
# Post-process recorded handbuch videos (see soll-ist.spec.ts /
# vertrieb.spec.ts): per clip, trim the setup head — everything before the
# first scene mark, i.e. session restore on the staged page — and convert
# WebM → MP4 (H.264, plays everywhere; the recordings carry no audio). With
# several clips, concatenate the trimmed clips (the actor ladder's
# perspective cut) into one <output>.mp4. Requires ffmpeg and deno.
#
#   bash test/e2e/videos/postprocess.sh soll-ist
#   bash test/e2e/videos/postprocess.sh vertrieb vertrieb-a vertrieb-b
set -euo pipefail
cd "$(dirname "$0")/../../.."

out="${1:?usage: postprocess.sh <output> [clip ...]}"
shift
clips=("$@")
[ ${#clips[@]} -gt 0 ] || clips=("$out")
dir="test-results/videos"

trim_one() { # <clip> <target.mp4>
  local clip="$1" target="$2"
  local webm="$dir/$clip.webm" marks="$dir/$clip.marks.json"
  [ -f "$webm" ] || { echo "missing $webm — run: deno task handbuch:videos"; exit 1; }
  # Cut 400 ms AFTER the first scene mark (the "Loading…" flash). The marks
  # are wall-clock but video time runs slightly compressed, so the flash's
  # video position lands AT or just under mark.t — any lead before the mark
  # re-exposes the settled logged-in screen the flash exists to hide
  # (observed with both 1 s and 250 ms leads). Cutting inside the flash is
  # safe: it holds 1.6 s, so ≥1 s of it survives the trim.
  local start_ms start_s
  start_ms=$(deno eval "
    const m = JSON.parse(Deno.readTextFileSync('$marks'));
    console.log(Math.max(0, (m[0]?.t ?? 0) + 400));
  ")
  start_s=$(awk "BEGIN{printf \"%.3f\", $start_ms/1000}")
  # `-ss` AFTER `-i` (output seeking): decode from the start and drop frames
  # up to the cut. Input seeking (`-ss` before `-i`) snaps to the previous
  # keyframe on Playwright's sparse-keyframe VP8, which leaked a flash of
  # pre-trim frames at the very start of the clip.
  ffmpeg -y -loglevel error -i "$webm" -ss "$start_s" \
    -c:v libx264 -pix_fmt yuv420p -crf 23 -an "$target"
  echo "  $clip → $target (trimmed ${start_s}s of setup)"
}

if [ ${#clips[@]} -eq 1 ]; then
  trim_one "${clips[0]}" "$dir/$out.mp4"
else
  list="$dir/.$out.concat"
  : > "$list"
  for clip in "${clips[@]}"; do
    trim_one "$clip" "$dir/.$clip.part.mp4"
    echo "file '.$clip.part.mp4'" >> "$list"
  done
  # Same encoder settings per part → stream copy is lossless and instant.
  ffmpeg -y -loglevel error -f concat -safe 0 -i "$list" -c copy "$dir/$out.mp4"
  rm -f "$list"
  for clip in "${clips[@]}"; do rm -f "$dir/.$clip.part.mp4"; done
fi
echo "→ $dir/$out.mp4"

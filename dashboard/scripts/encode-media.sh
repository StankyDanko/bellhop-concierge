#!/usr/bin/env bash
# Web-encodes the landing's films and the recorded call into dashboard/public/media/, which vite
# copies into dashboard/dist on build. Run it again whenever a film is re-rendered.
#
#   dashboard/scripts/encode-media.sh <source-dir>
#
# The source dir holds the editor's masters:
#   film-marisol-short.mp4  the hero film (Marisol at Casa Coralina)
#   film-hollis.mp4         the second film, shown by the Call Hollis number
#   film-poster.jpg         the hero still
#   call-marisol.mp3        the recorded call
#   call-marisol.cues.json  its captions: [{ start, end, speaker, text }], seconds
#
# Env overrides: HERO, HOLLIS (source file names), LOOP (the hero preview's shots as
# "start-end" pairs in seconds, comma separated; pick wide shots with no captions or phone screens).
# CPU only (libx264). Budgets: each film <= 15 MB, the loop <= 3 MB, the poster <= 300 KB.
set -euo pipefail

SRC=${1:?usage: encode-media.sh <source-dir>}
HERO=${HERO:-film-marisol-short.mp4}
HOLLIS=${HOLLIS:-film-hollis.mp4}
LOOP=${LOOP:-0.2-5.4,51.0-55.6}
OUT="$(cd "$(dirname "$0")/.." && pwd)/public/media"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

for f in "$HERO" "$HOLLIS" film-poster.jpg call-marisol.mp3 call-marisol.cues.json; do
  [[ -f "$SRC/$f" ]] || { echo "encode-media: missing $SRC/$f" >&2; exit 1; }
done

# 720p H.264 High, CRF 26 with a bitrate ceiling so a busy shot cannot blow the budget.
# faststart puts the index first, so the player starts before the whole file arrives.
film() {
  echo "-- $2"
  ffmpeg -hide_banner -v error -y -i "$1" \
    -vf "scale=-2:720:flags=lanczos,format=yuv420p" \
    -c:v libx264 -profile:v high -preset slow -crf 26 -maxrate 1000k -bufsize 2000k -g 60 \
    -c:a aac -b:a 96k -ac 2 -movflags +faststart "$TMP/$2"
  mv "$TMP/$2" "$OUT/$2"
}

film "$SRC/$HERO" film-marisol.mp4
film "$SRC/$HOLLIS" film-hollis.mp4

# The hero's muted preview: a few wide shots cut together, no audio track.
echo "-- film-marisol-loop.mp4"
inputs=()
chain=""
n=0
IFS=',' read -ra pairs <<< "$LOOP"
for p in "${pairs[@]}"; do
  a=${p%-*}; b=${p#*-}
  inputs+=(-ss "$a" -to "$b" -i "$SRC/$HERO")
  chain+="[$n:v:0]"
  n=$((n + 1))
done
ffmpeg -hide_banner -v error -y "${inputs[@]}" \
  -filter_complex "${chain}concat=n=${n}:v=1:a=0,scale=-2:720:flags=lanczos,format=yuv420p[v]" -map "[v]" -an \
  -c:v libx264 -profile:v high -preset slow -crf 27 -maxrate 1800k -bufsize 3600k -g 60 \
  -movflags +faststart "$TMP/film-marisol-loop.mp4"
mv "$TMP/film-marisol-loop.mp4" "$OUT/film-marisol-loop.mp4"

echo "-- film-poster.jpg"
ffmpeg -hide_banner -v error -y -i "$SRC/film-poster.jpg" -vf "scale=-2:720:flags=lanczos" -q:v 4 "$TMP/film-poster.jpg"
mv "$TMP/film-poster.jpg" "$OUT/film-poster.jpg"

# The call is already a 128k MP3 from the recorder; copy it when it is, re-encode when it is not.
echo "-- call-marisol.mp3"
rate=$(ffprobe -v error -select_streams a:0 -show_entries stream=bit_rate -of default=nw=1:nk=1 "$SRC/call-marisol.mp3")
codec=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of default=nw=1:nk=1 "$SRC/call-marisol.mp3")
if [[ "$codec" == mp3 && "$rate" =~ ^[0-9]+$ && "$rate" -le 130000 ]]; then
  ffmpeg -hide_banner -v error -y -i "$SRC/call-marisol.mp3" -map 0:a -c:a copy -map_metadata -1 "$TMP/call-marisol.mp3"
else
  ffmpeg -hide_banner -v error -y -i "$SRC/call-marisol.mp3" -map 0:a -c:a libmp3lame -b:a 128k -map_metadata -1 "$TMP/call-marisol.mp3"
fi
mv "$TMP/call-marisol.mp3" "$OUT/call-marisol.mp3"

# Captions: must parse, must be a non-empty list.
echo "-- call-marisol.cues.json"
node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(!Array.isArray(c)||!c.length)process.exit(1);process.stdout.write(JSON.stringify(c,null,1)+"\n")' \
  "$SRC/call-marisol.cues.json" > "$TMP/cues.json"
mv "$TMP/cues.json" "$OUT/call-marisol.cues.json"

# Budgets, in bytes.
fail=0
check() {
  local size; size=$(stat -c %s "$OUT/$1")
  printf '%-26s %8.2f MB  (max %s MB)\n' "$1" "$(echo "$size / 1048576" | bc -l)" "$(echo "$2 / 1048576" | bc -l | xargs printf '%.2f')"
  if (( size > $2 )); then echo "encode-media: $1 is over budget" >&2; fail=1; fi
}
check film-marisol.mp4 15728640
check film-hollis.mp4 15728640
check film-marisol-loop.mp4 3145728
check film-poster.jpg 307200
check call-marisol.mp3 1048576
check call-marisol.cues.json 65536
du -sh "$OUT"
exit $fail

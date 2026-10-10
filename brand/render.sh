#!/bin/sh
# Renders brand/*.html to PNG with headless Chrome (macOS / Linux). Usage: sh brand/render.sh
set -e
cd "$(dirname "$0")"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
[ -x "$CHROME" ] || CHROME="$(command -v google-chrome || command -v chromium)"
TMP="$(mktemp -d)"
render() { # $1 html, $2 png, $3 size
  rm -f "$2"
  "$CHROME" --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size="$3" \
    --virtual-time-budget=4000 --no-first-run --user-data-dir="$TMP" --screenshot="$PWD/$2" "file://$PWD/$1" >/dev/null 2>&1 &
  pid=$!
  # Headless Chrome on macOS sometimes lingers after writing the file; stop it once the PNG exists.
  i=0; while [ ! -s "$2" ] && [ $i -lt 40 ]; do sleep 0.5; i=$((i+1)); done
  kill $pid 2>/dev/null || true
  echo "rendered $2"
}
render banner.html banner.png 1280,640
sleep 1; rm -rf "$TMP" 2>/dev/null || true  # Chrome may still be flushing its profile

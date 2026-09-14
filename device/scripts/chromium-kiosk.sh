#!/bin/sh
set -eu

attempt=0
until curl --fail --silent --max-time 2 http://127.0.0.1:8080/api/state >/dev/null; do
  attempt=$((attempt + 1))
  if [ "${attempt}" -ge 30 ]; then
    echo "Muse Cam local server did not become ready" >&2
    exit 1
  fi
  sleep 1
done

xset s off
xset -dpms
xset s noblank

if command -v chromium >/dev/null 2>&1; then
  browser=chromium
elif command -v chromium-browser >/dev/null 2>&1; then
  browser=chromium-browser
else
  echo "Chromium is not installed" >&2
  exit 1
fi

exec "${browser}" \
  --kiosk \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --disable-background-networking \
  --disable-pinch \
  --disable-sync \
  --force-gpu-mem-available-mb=64 \
  --overscroll-history-navigation=0 \
  --password-store=basic \
  http://127.0.0.1:8080

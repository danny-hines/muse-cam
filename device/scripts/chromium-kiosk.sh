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

# A window manager must honor Chromium's fullscreen request. Without one,
# Chromium clamps even an explicitly sized window one pixel below the display,
# preventing DRI3 page flipping. Keep older installs usable until they install it.
if command -v matchbox-window-manager >/dev/null 2>&1 && command -v xprop >/dev/null 2>&1; then
  matchbox-window-manager -use_titlebar no &
  wm_pid=$!
  attempt=0
  until xprop -root _NET_SUPPORTING_WM_CHECK 2>/dev/null | grep -q 'window id'; do
    attempt=$((attempt + 1))
    if ! kill -0 "${wm_pid}" 2>/dev/null || [ "${attempt}" -ge 50 ]; then
      echo "Muse Cam kiosk window manager did not become ready" >&2
      exit 1
    fi
    sleep 0.1
  done
fi

display_size=$(xrandr --current | awk '/^Screen / {gsub(",", "", $10); print $8 "," $10; exit}')

exec "${browser}" \
  --kiosk \
  --window-position=0,0 \
  --window-size="${display_size:-800,480}" \
  --no-first-run \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-features=TranslateUI \
  --disable-background-networking \
  --disable-pinch \
  --disable-sync \
  --force-gpu-mem-available-mb=64 \
  --disable-gpu-rasterization \
  --overscroll-history-navigation=0 \
  --password-store=basic \
  http://127.0.0.1:8080

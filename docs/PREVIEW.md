# Touchscreen preview performance

MuseCam keeps still and preview streams allocated together to avoid camera
buffer allocation failures after a photo. The browser receives the low-resolution
stream as MJPEG; still captures retain their separate resolution and JPEG quality.

## Camera Module 3 on Pi 3B+

The DSI 4.3-inch profile uses a 30 fps sensor stream and targets a 15 fps, 800×480
browser preview. Each frame is JPEG-encoded once by Picamera2's YUV-aware encoder.
The controller passes those bytes directly to the browser and includes capture
and encoding time in its frame interval. Still images remain 1920×1280 at JPEG
quality 90. A 30 fps sensor cadence limits exposure to about 1/30 second; dim
scenes may require more gain than the previous 15 fps configuration.

Legacy screen backends can still request a PIL image. Other camera profiles keep
their existing sensor and preview rates until verified on their hardware.

## Kiosk rendering

The original X11 kiosk session had no window manager. Chromium's `--kiosk` flag
alone created a 780×460 window at (10, 10) on the 800×480 display, which prevented
direct full-screen page flipping. Explicit window geometry still produced a
799×479 window because Chromium clamps normal windows below the display size.
The launcher now starts Matchbox, a lightweight embedded window manager, to honor
the browser's fullscreen request. It also passes an explicit window position and
uses the display dimensions reported by `xrandr`.

The device installer includes `matchbox-window-manager` and `x11-utils`. On older
installs that update only the Python package and repository, install these once:

```sh
sudo apt-get install -y matchbox-window-manager x11-utils
sudo systemctl restart musecam-kiosk
```

The launcher retains its previous behavior if the window manager is unavailable,
so missing packages do not prevent the camera from starting.

Chromium also defaults to GPU rasterization on Raspberry Pi OS. In this build,
that used roughly 140–165 MB of VC4 graphics buffers and repeatedly failed to
allocate contiguous memory. Chromium then disabled its GL renderer. The launcher
disables GPU **rasterization** while retaining GPU **composition**, and limits
Chromium's compositor resource budget to 64 MB. This is not a total process or
system GPU-memory limit. A 64 MB compositor budget alone did not stop the failures.

With software rasterization, active V3D allocations fell to roughly 16–18 MB.
Once the window covered the display, the DRM scanout framebuffer IDs alternated
between complete frames instead of remaining fixed during preview updates.

## Measurements (2026-09-13)

On Danny's Pi 3B+ with Camera Module 3, PiSugar 3 Plus, and Waveshare 4.3-inch DSI:

- Before: MJPEG delivery **5.02 fps**, median interval **200 ms**.
- After the camera changes: **14.80 fps**, median interval **66.7 ms**.
- Final kiosk run after restart: **13.79 fps**, median interval **67.1 ms**,
  450 valid preview frames, hardware composition active, and alternating scanout
  framebuffers. The gallery increased by two photos during the verification.
- Standalone sensor-to-JPEG latency: median **77 ms → 49 ms**. This excludes
  browser decoding and display scanout; it is not a measured glass-to-glass delay.
- Still capture and preview resumption passed with both configurations.
- No camera mode switches or extra camera buffers were introduced.

The Pi reported its soft temperature limit active and reached 72°C during final
verification. Thermal protection remains enabled; enclosure cooling can still
affect sustained performance. The application's existing protection reduces the
preview rate at 75°C and restores it after cooling to 68°C.

Device backups: `/var/backups/musecam-preview-20260913/`.
Standalone diagnostic images and measurements:
`/var/lib/musecam/diagnostics/preview-20260913/`.

To investigate regressions, compare delivered MJPEG frame intervals, Chromium's
GPU process arguments (a fallback includes `--use-gl=disabled`), kernel GEM DMA
allocation errors, `/sys/kernel/debug/dri/0/bo_stats`, and the kiosk's actual
geometry via `xwininfo`. Check that scanout framebuffer IDs change while the
preview is active, rather than assuming `--kiosk` made the window full-screen.

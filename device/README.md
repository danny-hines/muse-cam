# Muse Cam device application

The device package contains the Raspberry Pi camera service, native UI, and production API client. It includes:

- Picamera2 and desktop-simulator camera adapters.
- Direct RGB565 framebuffer and Pimoroni Display HAT Mini outputs.
- Touch, integrated HAT button, GPIO shutter, and long-press power input.
- A responsive Pygame UI for preset selection, capture, processing, review, and sharing.
- A local HTTP/SSE/MJPEG service for the touch-first Chromium UI, with credentials isolated from the browser.
- SQLite persistence and offline retry using idempotent capture IDs.
- PiSugar 2 battery telemetry.
- Hardware diagnostics and systemd startup.

See [`../docs/DEVICE.md`](../docs/DEVICE.md) for installation, wiring, simulation, and hardware bring-up.

The API-only commands remain useful during diagnosis:

```bash
musecam health
musecam presets
musecam claim XXXX-XXXX-XXXX-XXXX
musecam submit /absolute/path/photo.jpg --preset kid-drawing --share
musecam doctor
```

# Muse Cam device application

The device package contains the Raspberry Pi camera service and production API client. It includes:

- Picamera2 and desktop-simulator camera adapters.
- A local HTTP/SSE/MJPEG service for the touch-first Chromium UI, with credentials isolated from the browser.
- GPIO shutter input.
- SQLite persistence and offline retry using idempotent capture IDs.
- PiSugar battery telemetry.
- Hardware diagnostics and systemd startup.
- A native Pygame UI and framebuffer outputs for [other hardware tested during development](../docs/DEVICE.md#other-tested-hardware).

See [`../docs/DEVICE.md`](../docs/DEVICE.md) for installation, wiring, simulation, and hardware bring-up.

The API-only commands remain useful during diagnosis:

```bash
musecam health
musecam presets
musecam claim XXXX-XXXX-XXXX-XXXX
musecam submit /absolute/path/photo.jpg --preset kid-drawing --share
musecam doctor
```

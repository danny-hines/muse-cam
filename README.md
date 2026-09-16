# Muse Cam

Muse Cam is a physical AI camera that captures a photograph, applies a playful Muse Image preset through Meta Model API, shows the result on the camera, and optionally publishes it to a public web roll.

This repository contains both sides of the project:

- `web/` — Next.js site and device API deployed to Vercel.
- `device-ui/` — touch-first React interface compiled into the Raspberry Pi package.
- `device/` — portable Python client and hardware profiles for Raspberry Pi.
- `hardware/` — physical build plan, working parts list, source CAD, and printable exports.
- `scripts/` — repeatable device installation tooling.
- `docs/` — API and deployment documentation.

## Current status

The web/API foundation is functional:

- Responsive public feed and individual photo pages.
- Individual, revocable device credentials plus a legacy single-token fallback.
- Event assignment and 30-minute, single-use device setup codes.
- Idempotent capture IDs.
- Generation, status, image download, share, and unshare endpoints.
- Six versioned image presets.
- Mock image transformation for end-to-end development without a Meta key.
- Neon Postgres and private/public Vercel Blob adapters.
- A protected operator dashboard for registration, moderation, and deletion.
- Opt-in original-photo publishing with an accessible before/after control.
- In-memory development fallbacks and included demo frames.

The Raspberry Pi application includes Picamera2 capture, local SQLite queuing, offline retry, diagnostics, systemd startup, and desktop simulation. It has two interchangeable front ends: the proven native framebuffer app for SPI/HAT displays and a local Chromium interface for the 800×480 Waveshare DSI display. The browser never receives the device credential; it talks only to the camera service on localhost.

## Local development

Requirements: Node.js 20.9+ and pnpm 11.

```bash
cp web/.env.example web/.env.local
pnpm install
pnpm dev
```

Set a development `DEVICE_API_TOKEN` in `web/.env.local`. With `MODEL_PROVIDER=mock`, Neon and Blob are optional. Open [http://localhost:3000](http://localhost:3000) for the feed and [http://localhost:3000/api/health](http://localhost:3000/api/health) for configuration status.

Useful commands:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --dir web token:hash
pnpm --dir web admin:credentials
```

## Deploying to Vercel

1. Import this repository into Vercel and select `web` as the project root.
2. Provision Neon Postgres from the Vercel Marketplace and connect it as `DATABASE_URL`.
3. Create two Vercel Blob stores: one **private** and one **public**.
4. Connect their tokens as `PRIVATE_BLOB_READ_WRITE_TOKEN` and `PUBLISHED_BLOB_READ_WRITE_TOKEN`.
5. Run `pnpm --dir web db:migrate` against the connected Neon database.
6. Generate operator credentials with `pnpm --dir web admin:credentials`, then add the two emitted environment variables to Vercel.
7. Keep the existing `DEVICE_API_TOKEN_SHA256` and `DEVICE_ID` during migration. New cameras can use individual credentials created at `/admin`.
8. Add `SITE_URL`. When enabling Muse Image, add `META_API_KEY`; the documented endpoint and `muse-image-1.0` model are built-in defaults.
9. Set `MODEL_PROVIDER=mock` for the first deployment smoke test.
10. Switch to `MODEL_PROVIDER=meta` after adding the Meta API key and running a live image-edit smoke test.

Production device mutations intentionally refuse to run until the database, both Blob stores, device authentication, and selected model provider are configured.

## API smoke test from a workstation

```bash
curl -X POST http://localhost:3000/api/device/generations \
  -H "Authorization: Bearer $MUSECAM_DEVICE_TOKEN" \
  -F "capture_id=test_$(date +%s)" \
  -F "preset_id=alien-visitor" \
  -F "image=@/absolute/path/to/photo.jpg"
```

See [docs/API.md](docs/API.md) for the complete flow.

## Raspberry Pi installation

The public installer supports the current Camera Module 3 / Pi 3B+ / DSI build and the alternate hardware profiles:

```bash
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-cam/main/scripts/install-device.sh \
  | sudo bash -s -- --profile pi3bplus-cam3-dsi43 --claim YOUR-SETUP-CODE
```

For the PiSugar 3 Plus, also complete [battery setup](docs/POWER.md) and set `MUSECAM_POWER_BACKEND=pisugar3`. Use `pi3bplus-imx415-tft35` for the SPI screen or `zero2-cam3-displayhat` for the Pi Zero 2 W version. See [docs/DEVICE.md](docs/DEVICE.md) for wiring, diagnostics, simulator usage, and hardware bring-up. See [docs/ADMIN.md](docs/ADMIN.md) for registration and moderation.

The [parts list](hardware/BOM.md), [illustrated build guide](hardware/BUILD.md), [GPIO wiring](hardware/WIRING.md), and [six enclosure STL files](hardware/stl/README.md) cover the Camera Module 3 / PiSugar 3 Plus build. The guide follows the September 16, 2026 assembly notes and includes ten [assembly photos](hardware/photos/README.md) plus four [completed-camera views](hardware/BUILD.md#completed-camera); print settings and a few measurements remain pending. The enclosed prototype processes photos over Wi-Fi and has working audio and battery reporting; Camera Module 3 autofocus remains unresolved in the [recorded hardware checks](docs/CAMERAS.md).

## Privacy defaults

- Uploaded source images are normalized and stripped of EXIF before storage.
- Originals and unshared results use a private Blob store.
- A result is copied to the public Blob store only after the share endpoint is called.
- The public feed never exposes the source photograph unless an operator explicitly enables originals for that photo or event.
- Hiding a photo deletes both public copies but retains private media; permanent deletion removes the database record and all stored media.

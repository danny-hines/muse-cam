# Muse Cam

Muse Cam is a physical AI camera that captures a photograph, applies a playful Muse Image preset through Meta Model API, shows the result on the camera, and optionally publishes it to a public web roll.

This repository contains both sides of the project:

- `web/` — Next.js site and device API deployed to Vercel.
- `device/` — portable Python client and hardware profiles for Raspberry Pi.
- `scripts/` — repeatable device installation tooling.
- `docs/` — API and deployment documentation.

## Current status

The web/API foundation is functional:

- Responsive public feed and individual photo pages.
- Device bearer-token authentication.
- Idempotent capture IDs.
- Generation, status, image download, share, and unshare endpoints.
- Six versioned image presets.
- Mock image transformation for end-to-end development without a Meta key.
- Neon Postgres and private/public Vercel Blob adapters.
- In-memory development fallbacks and included demo frames.

The Raspberry Pi client can call and exercise this API from a local image. Direct camera, display, touch, GPIO, and power integrations are the next milestone.

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
```

## Deploying to Vercel

1. Import this repository into Vercel and select `web` as the project root.
2. Provision Neon Postgres from the Vercel Marketplace and connect it as `DATABASE_URL`.
3. Create two Vercel Blob stores: one **private** and one **public**.
4. Connect their tokens as `PRIVATE_BLOB_READ_WRITE_TOKEN` and `PUBLISHED_BLOB_READ_WRITE_TOKEN`.
5. Generate a device token with `pnpm --dir web token:hash`.
6. Add the emitted hash as `DEVICE_API_TOKEN_SHA256`; keep the plaintext token for the camera.
7. Add `SITE_URL` and `DEVICE_ID`. When enabling Muse Image, add `META_API_KEY`; the documented endpoint and `muse-image-1.0` model are built-in defaults.
8. Set `MODEL_PROVIDER=mock` for the first deployment smoke test.
9. Run `pnpm --dir web db:migrate` once against the connected Neon database.
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

## Privacy defaults

- Uploaded source images are normalized and stripped of EXIF before storage.
- Originals and unshared results use a private Blob store.
- A result is copied to the public Blob store only after the share endpoint is called.
- The public feed never exposes the source photograph.
- Retention and moderation controls will be added before a public event deployment.

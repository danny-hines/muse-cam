# Operator dashboard

The private dashboard at `/admin` manages events, camera registration, and public-photo moderation. It is disabled until both admin environment variables are present.

## Configure access

Generate an operator key and a separate cookie-signing secret locally:

```bash
pnpm --dir web admin:credentials
```

Save the plaintext operator key in a password manager. Add only the emitted `ADMIN_KEY_SHA256` and `ADMIN_SESSION_SECRET` values to Vercel, then redeploy. Sessions are signed, `HttpOnly`, `SameSite=Strict`, production-only secure cookies that expire after 12 hours. Authentication is checked again inside every mutation.

This lightweight operator-key flow is appropriate for the showcase build and a small trusted operations team. Before delegating access broadly, replace it with an identity provider that supports individual accounts, MFA, and audit logs.

## Events and original photos

Events currently group cameras, label public detail pages, and define the privacy default for original photos. “Allow before-and-after originals” means that photos shared by a camera assigned to that event publish both the transformed image and the normalized source image. It is off by default.

For a photo shared without its original, an operator can later choose **Enable original**. The public detail page then displays explicit Transformed and Original controls. Originals are not revealed on feed hover.

## Register a camera

1. Create or choose an event.
2. Enter a suggested camera name and select **Create setup code**.
3. Within 30 minutes, run the displayed command on the camera.
4. Restart `musecam.service` if it is already running.

Each code is one-time and stored only as a hash. Each resulting camera token is unique and stored only as a hash. **Revoke** immediately blocks that camera without affecting other units.

For a fresh public-repository install, pass the code directly to the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-cam/main/scripts/install-device.sh \
  | sudo bash -s -- --profile pi3bplus-imx415-dsi43 --claim XXXX-XXXX-XXXX-XXXX
```

## Moderation

- **Hide** removes transformed and original public Blob objects and clears the public URL. Private copies remain available to the operator.
- **Delete permanently** removes public and private Blob objects and deletes the database record. The dashboard requires a browser confirmation first.
- **Revoke** disables a camera credential. It does not hide that camera's existing photos.

Rate limits, audit history, and role-based access are intentionally deferred hardening work; the individual device tokens and operator boundary make those additions incremental.

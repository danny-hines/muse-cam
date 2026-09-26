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

Every photo belongs to an event. Each event has a public gallery at `/<event-slug>` (for example, `/sei-nyc`). Open it with **View gallery** in the dashboard. The gallery shows only that event's shared photos; private photos stay private, and photo pages link back to and navigate within their event. The home page lists no photos: visitors enter an event code there, or a pasted gallery URL, and are taken to that event's gallery. Camera assignments apply to new uploads; older photos keep their saved event.

Events also define the privacy default for original photos. “Allow before-and-after originals” means that photos shared by a camera assigned to that event publish both the transformed image and the normalized source image. It is off by default.

For a photo shared without its original, an operator can later choose **Enable original**. The public detail page then displays explicit Transformed and Original controls. Originals are not revealed on feed hover.

Each event also has an **Automatically share new photos to the event gallery** setting, off by default. Set it when creating an event, or edit it under that event and select **Save settings**. You can also change whether future shares include originals there. Enabling auto-sharing does not publish older photos, and disabling it does not retract existing shares.

The server applies the event's auto-share setting when an upload first arrives. Successful auto-shares return their link with the generated photo, so the camera shows it as shared without a restart. Sharing failures retry the saved result without another model generation.

Deleting a photo in the camera gallery also retracts its public share, including a public original. Private server copies remain available for admin moderation. Offline deletions remove the local photo immediately and persist a share-removal request across camera restarts; the public link remains available until the camera reconnects and that request succeeds. The gallery shows pending share removals. Automatic local-history pruning does not retract public shares.

Deployment requires applying the database migration with `pnpm --dir web db:migrate`, deploying the updated web app, and updating the camera service and bundled device UI for deletion syncing. Deploy the server before updating cameras. Existing events retain manual sharing after migration.

## Register a camera

An existing camera configured with `DEVICE_API_TOKEN` or `DEVICE_API_TOKEN_SHA256` appears automatically when an operator opens the dashboard or the camera makes a request. It keeps its `DEVICE_ID` and credential, starts without an event, and supports the same event assignment and revoke controls as cameras registered with a setup code. Assign it an event before use. No reinstall is needed. Syncing or rotating the configured token preserves its event and revoked status.

1. Create or choose an event. Setup codes require one.
2. Enter a suggested camera name, choose the event, and select **Create setup code**.
3. Within 30 minutes, run the displayed command on the camera.
4. Restart `musecam.service` if it is already running.

Each code is one-time and stored only as a hash. Each resulting camera token is unique and stored only as a hash. **Revoke** immediately blocks that camera without affecting other units.

For a fresh public-repository install, pass the code directly to the installer:

```bash
curl -fsSL https://raw.githubusercontent.com/danny-hines/muse-cam/main/scripts/install-device.sh \
  | sudo bash -s -- --profile pi3bplus-imx415-dsi43 --claim XXXX-XXXX-XXXX-XXXX
```

If the installer stops with `Registration failed (500)`, package installation has
succeeded but the registration server failed. Check the server logs for
`/api/device/claim` and resolve that error first. Then generate a fresh setup code
and rerun the original installer command with the same hardware profile and the
new code. The installer reuses the existing checkout and finishes writing the
configuration and installing the services. Running `musecam claim` alone does not
finish an interrupted first installation.

## Rename a camera

In **Cameras**, edit the registered camera's **Name** and select **Save**. The name appears in the dashboard and on public photo cards and pages, including photos taken before the rename. Renaming is server-only: the camera keeps its registration, token, event, and revoked status, and needs no restart. Environment-configured cameras keep their new name when their token syncs or rotates.

## Change a camera's event

In **Cameras**, choose an event from the registered camera's **Event** dropdown and select **Save**. A camera can move between events but cannot be left without one. The camera keeps its registration and token; no restart is needed.

A camera without an event, such as a newly synced environment-configured camera, is marked **Uploads paused** in the dashboard. The server answers its uploads with a retryable `503`, so the camera keeps captures queued; once assigned, they upload to that event.

The change applies to new uploads, including captures waiting to be uploaded. Photos already uploaded keep their original event and follow that event's original-photo privacy setting.

## Moderation

- **Hide** removes transformed and original public Blob objects and clears the public URL. Private copies remain available to the operator.
- **Delete permanently** removes public and private Blob objects and deletes the database record. The dashboard requires a browser confirmation first.
- **Revoke** disables a camera credential. It does not hide that camera's existing photos.

Rate limits, audit history, and role-based access are intentionally deferred hardening work; the individual device tokens and operator boundary make those additions incremental.

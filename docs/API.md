# Device API

All camera routes except presets require:

```http
Authorization: Bearer <device token>
```

The server stores only SHA-256 token digests. New cameras receive an individual, revocable token; the original environment-configured token remains as a migration fallback. A camera can only read or share its own generations. Capture IDs must be stable across retries because the API uses them as idempotency keys.

## Register a camera

An operator first creates a single-use setup code at `/admin`. It expires after 30 minutes.

```http
POST /api/device/claim
Content-Type: application/json

{"code":"XXXX-XXXX-XXXX-XXXX","name":"Lobby Camera"}
```

The response contains a new plaintext token exactly once. The device CLI stores it in `/etc/musecam/device.env`; the server retains only its digest. Claim codes are also stored only as digests and cannot be reused.

## List presets

```http
GET /api/device/presets
```

Prompts are deliberately omitted from this public response. The device receives names, versions, descriptions, and display colors.

## Generate a frame

```http
POST /api/device/generations
Content-Type: multipart/form-data
```

Fields:

| Field | Required | Description |
| --- | --- | --- |
| `capture_id` | Yes | 8–128 URL-safe characters, reused for retries. |
| `preset_id` | Yes | ID returned by the presets endpoint. |
| `captured_at` | No | ISO-8601 timestamp including an offset. |
| `image` | Yes | JPEG, PNG, or WebP, at most 2.5 MB. |

The server rotates, resizes, converts to JPEG, and strips metadata before persistence or model submission.

Example response:

```json
{
  "id": "4aac41ab-8bc6-4eb6-8238-079fed301378",
  "captureId": "camera01_00042",
  "status": "complete",
  "presetId": "alien-visitor",
  "presetVersion": 1,
  "createdAt": "2026-08-31T20:00:00.000Z",
  "completedAt": "2026-08-31T20:00:08.000Z",
  "sharedAt": null,
  "imageUrl": "https://example.com/api/device/generations/4aac.../image",
  "shareUrl": null,
  "errorCode": null
}
```

Submitting the same `capture_id` again returns the existing job and does not call the model twice.

Every photo belongs to the camera's event. A camera without an event receives `503` with `details.code` set to `camera_unassigned`; the camera keeps the capture queued and retries, and the upload succeeds once an operator assigns an event.

If the camera's event has auto-sharing enabled when the upload first arrives, the completed response includes `shareUrl` and `sharedAt`. The event's originals setting still controls whether the source is public. A temporary auto-share failure returns `503`; retry with the same capture ID to publish the saved result without regenerating. Retried older manual or hidden photos are not automatically published when event settings change.

## Read status

```http
GET /api/device/generations/:id
```

The current implementation completes the model request synchronously, but the status resource makes the device client compatible with a future durable asynchronous worker.

## Download the private result

```http
GET /api/device/generations/:id/image
```

Returns the generated image with private cache headers. Device authentication is required.

## Share

```http
POST /api/device/generations/:id/share
```

Copies the result from private to public Blob storage, assigns an unguessable slug, and returns `shareUrl`. Repeated calls are idempotent. The normalized original is published too only when the photo's event has explicitly enabled originals.

## Unshare

```http
DELETE /api/device/generations/:id/share
```

Deletes all public copies and removes the frame from its event gallery. Private media is retained until an operator permanently deletes the capture.

## Retract a camera-deleted capture

```http
DELETE /api/device/captures/:captureId/share
```

Returns `{ "retracted": true }` once public copies have been removed. Private copies remain. This operation is idempotent and records the retraction even if the upload has not arrived yet, preventing late uploads or sharing retries from publishing a deleted capture. Subsequent generation or share requests for a retracted capture return `410`. A different camera cannot retract an existing capture it does not own.

The camera durably queues this request before removing the local database entry, including when an interrupted upload never returned a generation ID. Network and server failures keep the request queued with retry backoff.

## Health

```http
GET /api/health
```

Returns selected adapter names and whether production dependencies are ready. It never returns secret values.

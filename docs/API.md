# Device API

All camera routes except presets require:

```http
Authorization: Bearer <device token>
```

The server stores only the SHA-256 digest of the production token. Capture IDs must be stable across retries; the API uses them as idempotency keys.

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

Copies the result from private to public Blob storage, assigns an unguessable slug, and returns `shareUrl`. Repeated calls are idempotent.

## Unshare

```http
DELETE /api/device/generations/:id/share
```

Deletes the public Blob and removes the frame from the feed. The private result is retained for the configured retention period.

## Health

```http
GET /api/health
```

Returns selected adapter names and whether production dependencies are ready. It never returns secret values.

import { randomUUID } from "node:crypto";
import { z } from "zod";

import {
  getPreset,
  type Preset,
  presetAllowedForEvent,
  surpriseCandidates,
  surprisePreset,
} from "@/config/presets";
import { apiError, photoApiResponse } from "@/lib/api";
import { authenticateDevice, DeviceAuthError } from "@/lib/device-auth";
import { getFleetRepository } from "@/lib/fleet";
import { getMediaStore } from "@/lib/media";
import { getImageModelProvider } from "@/lib/model";
import { classifyGenerationError } from "@/lib/model/errors";
import { InvalidImageError, MAX_IMAGE_BYTES, normalizeInputImage } from "@/lib/model/image";
import { getPhotoRepository } from "@/lib/repository";
import { deviceApiIsAvailable } from "@/lib/runtime-config";
import { CaptureRetractedError, publishPhoto } from "@/lib/sharing";
import type { PhotoRecord } from "@/lib/types";

export const maxDuration = 300;

// A surprise photo tries up to this many styles when the model filters one.
const SURPRISE_ATTEMPTS = 3;

const generationFields = z.object({
  captureId: z.string().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  presetId: z.string().min(1).max(80),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
});

async function generationResponse(photo: PhotoRecord, request: Request, status: number) {
  if (photo.status === "complete" && photo.autoSharePending) {
    try {
      photo = await publishPhoto(photo);
    } catch (error) {
      if (error instanceof CaptureRetractedError) return apiError(error.message, 410);
      console.error("Auto-share failed; the completed photo is saved for retry", { photoId: photo.id, error });
      return apiError("Photo is ready, but sharing is temporarily unavailable. Retry this upload.", 503);
    }
  }
  return Response.json(photoApiResponse(photo, request), { status });
}

// Tries each style in turn. Only a filtered style falls through to the next, since
// other failures would likely repeat and the camera already retries busy errors.
async function transformWithFallback(bytes: Buffer, candidates: Preset[]) {
  for (const [index, preset] of candidates.entries()) {
    try {
      const result = await getImageModelProvider().transform({ bytes, contentType: "image/jpeg", preset });
      return { preset, result };
    } catch (error) {
      const last = index === candidates.length - 1;
      if (last || classifyGenerationError(error).code !== "content_filtered") throw error;
      console.warn("Surprise style was filtered; trying another", { presetId: preset.id });
    }
  }
  throw new Error("No styles to try");
}

export async function POST(request: Request) {
  let deviceId: string;
  let eventId: string | null;
  try {
    ({ deviceId, eventId } = await authenticateDevice(request));
  } catch (error) {
    if (error instanceof DeviceAuthError) return apiError(error.message, error.status);
    return apiError("Unable to authenticate device", 401);
  }

  if (!deviceApiIsAvailable()) {
    return apiError("Production services are not fully configured", 503);
  }
  // Every photo belongs to an event. A 503 keeps captures queued on the camera
  // until an operator assigns it, and then they upload to that event.
  if (!eventId) {
    return apiError("Camera is not assigned to an event", 503, { code: "camera_unassigned" });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_IMAGE_BYTES + 256_000) {
    return apiError("Request is too large", 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return apiError("Expected multipart form data", 400);
  }

  const parsed = generationFields.safeParse({
    captureId: form.get("capture_id"),
    presetId: form.get("preset_id"),
    capturedAt: form.get("captured_at") || undefined,
  });
  if (!parsed.success) {
    return apiError("Invalid generation fields", 400, z.treeifyError(parsed.error));
  }

  const image = form.get("image");
  if (!(image instanceof File)) {
    return apiError("The image field is required", 400);
  }

  const surprise = parsed.data.presetId === surprisePreset.id;
  const requested = surprise ? null : getPreset(parsed.data.presetId);
  if (!surprise && !requested) {
    return apiError("Unknown preset", 400);
  }

  const repository = getPhotoRepository();
  if (await repository.isCaptureRetracted(deviceId, parsed.data.captureId)) {
    return apiError("Photo was deleted on the camera", 410);
  }
  const existing = await repository.findByCaptureId(parsed.data.captureId);
  if (existing) {
    if (existing.deviceId !== deviceId) return apiError("Capture ID is already in use", 409);
    const status = existing.status === "processing" ? 202 : 200;
    return generationResponse(existing, request, status);
  }

  const event = await getFleetRepository().findEventById(eventId);
  const candidates = requested ? [requested] : surpriseCandidates(event).slice(0, SURPRISE_ATTEMPTS);
  if (requested && !presetAllowedForEvent(requested, event)) {
    // Not retryable: the camera keeps the original so a guest can restyle it.
    return apiError("This style isn't available at this camera's event", 403, {
      code: "preset_unavailable",
    });
  }

  let normalizedImage: Buffer;
  try {
    normalizedImage = await normalizeInputImage(image);
  } catch (error) {
    if (error instanceof InvalidImageError) return apiError(error.message, 400);
    return apiError("Unable to prepare image", 400);
  }

  const photo = await repository.create({
    id: randomUUID(),
    captureId: parsed.data.captureId,
    deviceId,
    eventId,
    autoSharePending: event?.autoShare ?? false,
    presetId: candidates[0].id,
    presetVersion: candidates[0].version,
    capturedAtDevice: parsed.data.capturedAt ? new Date(parsed.data.capturedAt) : null,
  });

  try {
    const media = getMediaStore();
    const originalPrivateRef = await media.storePrivate(
      "originals",
      photo.id,
      normalizedImage,
      "image/jpeg",
    );
    const { preset, result } = await transformWithFallback(normalizedImage, candidates);
    const resultPrivateRef = await media.storePrivate(
      "results",
      photo.id,
      result.bytes,
      result.contentType,
    );
    const completed = await repository.markComplete(photo.id, {
      presetId: preset.id,
      presetVersion: preset.version,
      originalPrivateRef,
      resultPrivateRef,
      resultMimeType: result.contentType,
      width: result.width,
      height: result.height,
    });
    return generationResponse(completed, request, 201);
  } catch (error) {
    const { code, message, status } = classifyGenerationError(error);
    await repository.markFailed(photo.id, code);
    console.error("Generation failed", {
      photoId: photo.id,
      presetIds: candidates.map(({ id }) => id),
      errorCode: code,
      error,
    });
    return apiError(message, status, { code, id: photo.id });
  }
}

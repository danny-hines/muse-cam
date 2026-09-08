import { randomUUID } from "node:crypto";
import { z } from "zod";

import { getPreset } from "@/config/presets";
import { apiError, photoApiResponse } from "@/lib/api";
import { authenticateDevice, DeviceAuthError } from "@/lib/device-auth";
import { getMediaStore } from "@/lib/media";
import { getImageModelProvider } from "@/lib/model";
import { classifyGenerationError } from "@/lib/model/errors";
import { InvalidImageError, MAX_IMAGE_BYTES, normalizeInputImage } from "@/lib/model/image";
import { getPhotoRepository } from "@/lib/repository";
import { deviceApiIsAvailable } from "@/lib/runtime-config";

export const maxDuration = 300;

const generationFields = z.object({
  captureId: z.string().min(8).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  presetId: z.string().min(1).max(80),
  capturedAt: z.iso.datetime({ offset: true }).optional(),
});

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

  const preset = getPreset(parsed.data.presetId);
  if (!preset) {
    return apiError("Unknown preset", 400);
  }

  const repository = getPhotoRepository();
  const existing = await repository.findByCaptureId(parsed.data.captureId);
  if (existing) {
    if (existing.deviceId !== deviceId) return apiError("Capture ID is already in use", 409);
    const status = existing.status === "processing" ? 202 : 200;
    return Response.json(photoApiResponse(existing, request), { status });
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
    presetId: preset.id,
    presetVersion: preset.version,
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
    const result = await getImageModelProvider().transform({
      bytes: normalizedImage,
      contentType: "image/jpeg",
      preset,
    });
    const resultPrivateRef = await media.storePrivate(
      "results",
      photo.id,
      result.bytes,
      result.contentType,
    );
    const completed = await repository.markComplete(photo.id, {
      originalPrivateRef,
      resultPrivateRef,
      resultMimeType: result.contentType,
      width: result.width,
      height: result.height,
    });
    return Response.json(photoApiResponse(completed, request), { status: 201 });
  } catch (error) {
    const { code, message, status } = classifyGenerationError(error);
    await repository.markFailed(photo.id, code);
    console.error("Generation failed", {
      photoId: photo.id,
      presetId: preset.id,
      presetVersion: preset.version,
      errorCode: code,
      error,
    });
    return apiError(message, status, { code, id: photo.id });
  }
}

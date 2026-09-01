import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { apiError, photoApiResponse } from "@/lib/api";
import { authenticateDevice, DeviceAuthError } from "@/lib/device-auth";
import { getMediaStore } from "@/lib/media";
import { getPhotoRepository } from "@/lib/repository";

type RouteContext = { params: Promise<{ id: string }> };

function publicSlug(): string {
  return randomBytes(9).toString("base64url");
}

function authenticate(request: Request): Response | null {
  try {
    authenticateDevice(request);
    return null;
  } catch (error) {
    if (error instanceof DeviceAuthError) return apiError(error.message, error.status);
    return apiError("Unable to authenticate device", 401);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const authError = authenticate(request);
  if (authError) return authError;

  const { id } = await params;
  const repository = getPhotoRepository();
  const photo = await repository.findById(id);
  if (!photo) return apiError("Generation not found", 404);
  if (photo.status !== "complete" || !photo.resultPrivateRef || !photo.resultMimeType) {
    return apiError("Generation is not ready to share", 409);
  }
  if (photo.publicSlug && photo.resultPublicUrl) {
    return Response.json(photoApiResponse(photo, request));
  }

  try {
    const publicUrl = await getMediaStore().publish(
      photo.resultPrivateRef,
      photo.id,
      photo.resultMimeType,
    );
    const shared = await repository.markShared(photo.id, publicSlug(), publicUrl);
    revalidatePath("/");
    revalidatePath(`/p/${shared.publicSlug}`);
    return Response.json(photoApiResponse(shared, request));
  } catch (error) {
    console.error("Unable to share image", { photoId: photo.id, error });
    return apiError("Unable to publish image", 502);
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const authError = authenticate(request);
  if (authError) return authError;

  const { id } = await params;
  const repository = getPhotoRepository();
  const photo = await repository.findById(id);
  if (!photo) return apiError("Generation not found", 404);
  if (!photo.resultPublicUrl) return Response.json(photoApiResponse(photo, request));

  try {
    const previousSlug = photo.publicSlug;
    await getMediaStore().removePublic(photo.resultPublicUrl);
    const unshared = await repository.markUnshared(photo.id);
    revalidatePath("/");
    if (previousSlug) revalidatePath(`/p/${previousSlug}`);
    return Response.json(photoApiResponse(unshared, request));
  } catch (error) {
    console.error("Unable to unshare image", { photoId: photo.id, error });
    return apiError("Unable to remove public image", 502);
  }
}

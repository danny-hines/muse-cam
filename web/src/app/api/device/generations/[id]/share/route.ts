import { apiError, photoApiResponse } from "@/lib/api";
import { authenticateDevice, DeviceAuthError } from "@/lib/device-auth";
import { getPhotoRepository } from "@/lib/repository";
import { CaptureRetractedError, publishPhoto, unpublishPhoto } from "@/lib/sharing";

type RouteContext = { params: Promise<{ id: string }> };

async function authenticate(request: Request): Promise<{ deviceId: string } | Response> {
  try {
    return await authenticateDevice(request);
  } catch (error) {
    if (error instanceof DeviceAuthError) return apiError(error.message, error.status);
    return apiError("Unable to authenticate device", 401);
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const photo = await getPhotoRepository().findById(id);
  if (!photo || photo.deviceId !== auth.deviceId) return apiError("Generation not found", 404);
  if (photo.status !== "complete" || !photo.resultPrivateRef || !photo.resultMimeType) {
    return apiError("Generation is not ready to share", 409);
  }
  try {
    return Response.json(photoApiResponse(await publishPhoto(photo), request));
  } catch (error) {
    if (error instanceof CaptureRetractedError) return apiError(error.message, 410);
    console.error("Unable to share image", { photoId: photo.id, error });
    return apiError("Unable to publish image", 502);
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const auth = await authenticate(request);
  if (auth instanceof Response) return auth;
  const { id } = await params;
  const photo = await getPhotoRepository().findById(id);
  if (!photo || photo.deviceId !== auth.deviceId) return apiError("Generation not found", 404);
  try {
    return Response.json(photoApiResponse(await unpublishPhoto(photo), request));
  } catch (error) {
    console.error("Unable to unshare image", { photoId: photo.id, error });
    return apiError("Unable to remove public image", 502);
  }
}

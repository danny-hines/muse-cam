import { apiError, photoApiResponse } from "@/lib/api";
import { authenticateDevice, DeviceAuthError } from "@/lib/device-auth";
import { getPhotoRepository } from "@/lib/repository";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  let deviceId: string;
  try {
    ({ deviceId } = await authenticateDevice(request));
  } catch (error) {
    if (error instanceof DeviceAuthError) return apiError(error.message, error.status);
    return apiError("Unable to authenticate device", 401);
  }

  const { id } = await params;
  const photo = await getPhotoRepository().findById(id);
  if (!photo) return apiError("Generation not found", 404);
  if (photo.deviceId !== deviceId) return apiError("Generation not found", 404);

  return Response.json(photoApiResponse(photo, request));
}

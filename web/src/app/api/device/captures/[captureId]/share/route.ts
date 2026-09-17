import { apiError } from "@/lib/api";
import { authenticateDevice, DeviceAuthError } from "@/lib/device-auth";
import { getPhotoRepository } from "@/lib/repository";
import { unpublishPhoto } from "@/lib/sharing";

type RouteContext = { params: Promise<{ captureId: string }> };

export async function DELETE(request: Request, { params }: RouteContext) {
  let deviceId: string;
  try {
    ({ deviceId } = await authenticateDevice(request));
  } catch (error) {
    if (error instanceof DeviceAuthError) return apiError(error.message, error.status);
    return apiError("Unable to authenticate device", 401);
  }
  const { captureId } = await params;
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(captureId)) return apiError("Invalid capture ID", 400);
  const repository = getPhotoRepository();
  const existing = await repository.findByCaptureId(captureId);
  if (existing && existing.deviceId !== deviceId) return apiError("Capture not found", 404);

  try {
    await repository.retractCapture(deviceId, captureId);
    // Read after recording the retraction to catch a share finishing concurrently.
    const photo = await repository.findByCaptureId(captureId);
    if (photo && photo.deviceId === deviceId) await unpublishPhoto(photo);
    return Response.json({ retracted: true });
  } catch (error) {
    console.error("Unable to retract camera photo", { captureId, error });
    return apiError("Unable to remove public image; retry the retraction", 503);
  }
}

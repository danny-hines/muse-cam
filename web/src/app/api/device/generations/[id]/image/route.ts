import { apiError } from "@/lib/api";
import { authenticateDevice, DeviceAuthError } from "@/lib/device-auth";
import { getMediaStore } from "@/lib/media";
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
  if (!photo?.resultPrivateRef || photo.status !== "complete") {
    return apiError("Generated image is not available", 404);
  }
  if (photo.deviceId !== deviceId) return apiError("Generated image is not available", 404);

  try {
    const image = await getMediaStore().readPrivate(photo.resultPrivateRef);
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "Content-Type": photo.resultMimeType ?? image.contentType,
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(image.bytes.byteLength),
      },
    });
  } catch (error) {
    console.error("Unable to read generated image", { photoId: photo.id, error });
    return apiError("Generated image is unavailable", 502);
  }
}

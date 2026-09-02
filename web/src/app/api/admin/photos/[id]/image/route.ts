import { apiError } from "@/lib/api";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { getMediaStore } from "@/lib/media";
import { getPhotoRepository } from "@/lib/repository";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  if (!(await isAdminAuthenticated())) return apiError("Unauthorized", 401);
  const { id } = await params;
  const photo = await getPhotoRepository().findById(id);
  if (!photo) return apiError("Photo not found", 404);

  const kind = new URL(request.url).searchParams.get("kind");
  const ref = kind === "original" ? photo.originalPrivateRef : photo.resultPrivateRef;
  if (!ref) return apiError("Image not available", 404);

  try {
    const image = await getMediaStore().readPrivate(ref);
    return new Response(new Uint8Array(image.bytes), {
      headers: {
        "Content-Type":
          kind === "original" ? "image/jpeg" : (photo.resultMimeType ?? image.contentType),
        "Cache-Control": "private, no-store",
        "Content-Length": String(image.bytes.byteLength),
      },
    });
  } catch (error) {
    console.error("Unable to read admin photo preview", { photoId: id, error });
    return apiError("Image unavailable", 502);
  }
}

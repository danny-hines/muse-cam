import { getStyleCatalog } from "@/lib/styles";
import type { PhotoRecord } from "@/lib/types";

export function apiError(error: string, status: number, details?: unknown) {
  return Response.json({ error, details }, { status });
}

export async function photoApiResponse(photo: PhotoRecord, request: Request) {
  const catalog = await getStyleCatalog();
  const origin = new URL(request.url).origin;
  return {
    id: photo.id,
    captureId: photo.captureId,
    status: photo.status,
    presetId: photo.presetId,
    // Surprise photos use a style the camera may not know, so it needs the name.
    presetName: catalog.get(photo.presetId)?.name ?? null,
    presetVersion: photo.presetVersion,
    createdAt: photo.createdAt.toISOString(),
    completedAt: photo.completedAt?.toISOString() ?? null,
    sharedAt: photo.sharedAt?.toISOString() ?? null,
    imageUrl:
      photo.status === "complete" ? `${origin}/api/device/generations/${photo.id}/image` : null,
    shareUrl: photo.publicSlug ? `${origin}/p/${photo.publicSlug}` : null,
    errorCode: photo.errorCode,
  };
}

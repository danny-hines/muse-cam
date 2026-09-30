import { apiError } from "@/lib/api";
import { getEventBySlug, listPublishedPhotos } from "@/lib/photos";

// Live galleries and slideshows poll this for new and hidden photos.
export async function GET(_request: Request, { params }: { params: Promise<{ eventSlug: string }> }) {
  const { eventSlug } = await params;
  const event = await getEventBySlug(eventSlug);
  if (!event) return apiError("Event not found", 404);
  return Response.json(
    { photos: await listPublishedPhotos(event) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

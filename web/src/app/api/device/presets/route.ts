import { presetsForEvent, surprisePreset } from "@/config/presets";
import { apiError } from "@/lib/api";
import { authenticateDevice, DeviceAuthError } from "@/lib/device-auth";
import { getFleetRepository } from "@/lib/fleet";
import type { EventRecord } from "@/lib/types";

// Cameras have always sent their credential here, so an event's styles reach
// existing cameras without an update. Anyone else gets the default catalog.
export async function GET(request: Request) {
  let event: EventRecord | null = null;
  if (request.headers.has("authorization")) {
    try {
      const { eventId } = await authenticateDevice(request);
      if (eventId) event = await getFleetRepository().findEventById(eventId);
    } catch (error) {
      if (!(error instanceof DeviceAuthError)) {
        // A failure keeps the camera on its cached list instead of the default one.
        console.error("Unable to load event styles", { error });
        return apiError("Styles are temporarily unavailable", 503);
      }
    }
  }

  // The camera adds its own Random entry, which resolves to Surprise as well.
  const listed = event?.surpriseStyles ? [surprisePreset] : presetsForEvent(event);
  return Response.json(
    {
      presets: listed.map((preset) => ({
        id: preset.id,
        version: preset.version,
        name: preset.name,
        description: preset.description,
        accent: preset.accent,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

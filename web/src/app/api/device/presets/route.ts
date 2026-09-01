import { presets } from "@/config/presets";

export function GET() {
  return Response.json(
    {
      presets: presets.map((preset) => ({
        id: preset.id,
        version: preset.version,
        name: preset.name,
        description: preset.description,
        accent: preset.accent,
      })),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}

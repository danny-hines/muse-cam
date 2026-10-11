import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import sharp from "sharp";
import { z } from "zod";

import { presetSchema, styleCatalog } from "@/config/presets";
import { getFleetRepository } from "@/lib/fleet";
import type { EventStyle } from "@/lib/fleet/types";
import { getMediaStore } from "@/lib/media";

// Event-only styles are an installation's private configuration, so they are stored
// with its events rather than built in. A render or request loads them once.
export const getStyleCatalog = cache(async () =>
  styleCatalog(await getFleetRepository().listEventStyles()),
);

// The styles.json in a folder of event-only styles. See web/event-styles.example.
export const eventStylesFileSchema = z.object({
  styles: z.array(
    presetSchema.omit({ referenceImageRefs: true, eventOnly: true }).extend({
      // JPEG files in the same folder, sent to the model after the photo in this order.
      referenceImages: z.array(z.string().min(1)).min(1).optional(),
    }).strict(),
  ).min(1),
}).strict();

export type LoadedEventStyle = { id: string; version: number; referenceImages: number };

// Adds or replaces each style in a folder, storing reference images as private media.
// Everything is checked before anything is written. Styles not in the folder are kept.
export async function loadEventStyles(
  folder: string,
  { dryRun = false } = {},
): Promise<LoadedEventStyle[]> {
  const file = JSON.parse(await readFile(path.join(folder, "styles.json"), "utf8"));
  const { styles } = eventStylesFileSchema.parse(file);
  const builtIn = styleCatalog([]);
  const seen = new Set<string>();
  const images = new Map<string, Buffer>();
  for (const style of styles) {
    if (builtIn.get(style.id)) throw new Error(`${style.id} is already a built-in style`);
    if (seen.has(style.id)) throw new Error(`${style.id} is listed twice`);
    seen.add(style.id);
    for (const name of style.referenceImages ?? []) {
      const bytes = await readFile(path.join(folder, name));
      const { format, width = 0, height = 0 } = await sharp(bytes).metadata();
      if (format !== "jpeg") throw new Error(`${name} must be a JPEG`);
      if (Math.max(width, height) > 2048) throw new Error(`${name} must be at most 2048 pixels on its longest side`);
      images.set(name, bytes);
    }
  }

  const loaded = styles.map(({ id, version, referenceImages = [] }) => ({
    id, version, referenceImages: referenceImages.length,
  }));
  if (dryRun) return loaded;

  const repository = getFleetRepository();
  const media = getMediaStore();
  const previous = new Map((await repository.listEventStyles()).map((style) => [style.id, style]));
  for (const { referenceImages = [], ...fields } of styles) {
    const referenceImageRefs = await Promise.all(referenceImages.map((name, index) =>
      media.storePrivate("references", `${fields.id}-${index + 1}`, images.get(name)!, "image/jpeg"),
    ));
    const style: EventStyle = referenceImageRefs.length > 0 ? { ...fields, referenceImageRefs } : fields;
    await repository.saveEventStyle(style);
    for (const ref of previous.get(fields.id)?.referenceImageRefs ?? []) {
      if (!referenceImageRefs.includes(ref)) await media.removePrivate(ref);
    }
  }
  return loaded;
}

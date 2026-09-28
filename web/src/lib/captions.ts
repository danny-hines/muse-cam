import { after } from "next/server";

import { getPreset } from "@/config/presets";
import { getMediaStore } from "@/lib/media";
import { getCaptionProvider } from "@/lib/model";
import { getPhotoRepository } from "@/lib/repository";
import type { PhotoRecord } from "@/lib/types";

export async function writeCaption(photo: PhotoRecord): Promise<string> {
  const preset = getPreset(photo.presetId);
  if (!preset || !photo.resultPrivateRef) throw new Error("Photo has no result to caption");
  const { bytes } = await getMediaStore().readPrivate(photo.resultPrivateRef);
  const caption = await getCaptionProvider().caption({ bytes, preset });
  await getPhotoRepository().saveCaption(photo.id, caption);
  return caption;
}

// Captioning takes several seconds, so it runs after the camera has its share response.
// A failure only leaves the photo uncaptioned; operators can retry from /admin.
export function captionAfterResponse(photo: PhotoRecord): void {
  if (photo.caption) return;
  after(async () => {
    try {
      await writeCaption(photo);
    } catch (error) {
      console.error("Unable to caption photo", { photoId: photo.id, error });
    }
  });
}

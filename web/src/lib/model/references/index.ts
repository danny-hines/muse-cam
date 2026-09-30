import type { ReferenceImageName } from "@/config/presets";
import disc2 from "./disc-2.json";
import eventStyle2 from "./event-style-2.json";
import muse from "./muse.json";

// JPEGs, base64-encoded so the bundler ships them with the server code.
export const referenceImages: Record<ReferenceImageName, { base64: string }> = {
  "disc-2": disc2,
  muse,
  "event-style-2": eventStyle2,
};

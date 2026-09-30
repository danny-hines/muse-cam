import type { ReferenceImageName } from "@/config/presets";
import disc2 from "./disc-2.json";
import keynoteFit from "./keynote-fit.json";
import muse from "./muse.json";

// JPEGs, base64-encoded so the bundler ships them with the server code.
export const referenceImages: Record<ReferenceImageName, { base64: string }> = {
  "disc-2": disc2,
  muse,
  "keynote-fit": keynoteFit,
};

import { presets } from "./presets";

// A standalone camera calls the image model itself, so it bundles the public styles
// with their prompts. Event-only styles stay on the server and never reach this list.
export function deviceStyles() {
  return presets.map(({ id, version, name, description, accent, prompt }) => ({
    id,
    version,
    name,
    description,
    accent,
    prompt,
  }));
}

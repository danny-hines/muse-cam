import { fileURLToPath } from "node:url";

import type { Preset } from "@/config/presets";
import { getStyleCatalog, loadEventStyles } from "@/lib/styles";

// The event-only style in web/event-styles.example, loaded the way production loads one.
export const exampleEventStylesFolder = fileURLToPath(new URL("../../event-styles.example/", import.meta.url));

export async function loadExampleEventStyle(): Promise<Preset> {
  await loadEventStyles(exampleEventStylesFolder);
  return (await getStyleCatalog()).get("party-hats")!;
}

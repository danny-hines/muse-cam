// Writes the public styles, prompts included, for the camera's standalone mode.
// Run it after changing a built-in style:
//   pnpm --dir web styles:export
import { writeFileSync } from "node:fs";

import { deviceStyles } from "@/config/device-styles";

const output = new URL("../../device/src/musecam/standalone-presets.json", import.meta.url);
writeFileSync(output, `${JSON.stringify(deviceStyles(), null, 2)}\n`);
console.log(`Wrote ${deviceStyles().length} styles to device/src/musecam/standalone-presets.json`);

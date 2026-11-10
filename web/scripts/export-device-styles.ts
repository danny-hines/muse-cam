// Writes the public styles for the camera. Run it after changing a built-in style:
//   pnpm --dir web styles:export
import { writeFileSync } from "node:fs";

import { deviceStyles } from "@/config/device-styles";

const write = (name: string, value: unknown) =>
  writeFileSync(
    new URL(`../../device/src/musecam/${name}`, import.meta.url),
    `${JSON.stringify(value, null, 2)}\n`,
  );
const styles = deviceStyles();
// Standalone cameras call the image model themselves, so they need the prompts.
write("standalone-presets.json", styles);
// The list a connected camera shows before it has reached the server.
write(
  "presets.json",
  styles.map(({ id, version, name, description, accent, category }) => ({
    id, version, name, description, accent, category,
  })),
);
console.log(`Wrote ${styles.length} styles to device/src/musecam`);

// Adds or replaces private event-only styles from a folder holding styles.json and its
// reference images (see event-styles.example). Like db:migrate, it uses .env.local.
//   pnpm event-styles:load <folder> [--dry-run]
import { hasPersistentMediaStore } from "@/lib/media";
import { hasPersistentDatabase } from "@/lib/repository";
import { loadEventStyles } from "@/lib/styles";

const [folder, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
if (!folder) {
  console.error("Usage: pnpm event-styles:load <folder> [--dry-run]");
  process.exit(1);
}
if (!dryRun && !(hasPersistentDatabase() && hasPersistentMediaStore())) {
  console.error("DATABASE_URL and both Blob tokens are required; nothing was saved.");
  process.exit(1);
}

const loaded = await loadEventStyles(folder, { dryRun });
for (const { id, version, referenceImages } of loaded) {
  console.log(`${id} v${version}${referenceImages ? ` · ${referenceImages} reference image(s)` : ""}`);
}
console.log(dryRun ? "Checked; nothing was saved." : `Saved ${loaded.length} event-only style(s).`);

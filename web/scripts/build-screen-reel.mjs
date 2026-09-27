// Builds the photo reel shown on the home-page camera's screen from the most
// recent photos on an event page:
//
//   pnpm screen:build https://www.muse-cam.com/sei-nyc [count]
//
// Reads the public page, so it needs no database access. Each photo is cropped
// to the screen's 95 × 54 mm active area and packed into one WebP atlas, with a
// manifest listing the style of each tile, newest first.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "../public/models");
// The screen texture draws 6 px per millimetre.
const TILE = { width: 570, height: 324 };
const COLUMNS = 3;

const [eventUrl, countArgument = "12"] = process.argv.slice(2);
if (!eventUrl) throw new Error("Usage: pnpm screen:build <event page URL> [count]");
const count = Number(countArgument);

const decode = (text) =>
  text.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

const response = await fetch(eventUrl);
if (!response.ok) throw new Error(`${eventUrl} returned ${response.status}`);
const html = await response.text();
// Event pages list photo cards newest first.
const photos = html
  .split('<article class="photo-card"')
  .slice(1, count + 1)
  .map((card) => ({
    style: decode(card.match(/class="preset-name">([^<]*)/)?.[1] ?? ""),
    url: decodeURIComponent(card.match(/\/_next\/image\?url=([^"&]*)/)?.[1] ?? ""),
  }));
if (photos.length < count || photos.some((photo) => !photo.style || !photo.url)) {
  throw new Error(`Found ${photos.length} complete photo cards on ${eventUrl}; expected ${count}`);
}

const tiles = await Promise.all(
  photos.map(async ({ url }) => {
    const image = await fetch(url);
    if (!image.ok) throw new Error(`${url} returned ${image.status}`);
    return sharp(Buffer.from(await image.arrayBuffer())).resize(TILE.width, TILE.height, { fit: "cover" }).toBuffer();
  }),
);

const rows = Math.ceil(tiles.length / COLUMNS);
mkdirSync(outDir, { recursive: true });
const atlas = await sharp({ create: { width: TILE.width * COLUMNS, height: TILE.height * rows, channels: 3, background: "#000" } })
  .composite(tiles.map((input, i) => ({ input, left: (i % COLUMNS) * TILE.width, top: Math.floor(i / COLUMNS) * TILE.height })))
  .webp({ quality: 72, effort: 6 })
  .toFile(join(outDir, "screen-reel.webp"));

const manifest = { image: "screen-reel.webp", tileWidth: TILE.width, tileHeight: TILE.height, columns: COLUMNS, styles: photos.map((photo) => photo.style) };
writeFileSync(join(outDir, "screen-reel.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote screen-reel.webp (${(atlas.size / 1024).toFixed(0)} KB) with ${photos.length} photos: ${manifest.styles.join(", ")}`);

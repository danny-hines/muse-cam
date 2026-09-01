import sharp from "sharp";

import type { ImageModelProvider, TransformInput, TransformResult } from "./types";

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      "'": "&apos;",
      '\"': "&quot;",
    };
    return entities[character];
  });
}

export class MockImageProvider implements ImageModelProvider {
  async transform({ bytes, preset }: TransformInput): Promise<TransformResult> {
    const source = sharp(bytes).rotate();
    const metadata = await source.metadata();
    const width = metadata.width ?? 1_536;
    const height = metadata.height ?? 1_024;

    const overlay = Buffer.from(`
      <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
            <stop stop-color="${preset.accent}" stop-opacity=".26" />
            <stop offset=".55" stop-color="#000000" stop-opacity="0" />
            <stop offset="1" stop-color="#171713" stop-opacity=".24" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#wash)" />
        <rect x="${Math.round(width * 0.035)}" y="${Math.round(height * 0.88)}"
          width="${Math.max(220, Math.round(width * 0.35))}" height="${Math.max(42, Math.round(height * 0.07))}"
          rx="${Math.round(height * 0.025)}" fill="#171713" fill-opacity=".76" />
        <text x="${Math.round(width * 0.055)}" y="${Math.round(height * 0.927)}"
          fill="#ffffff" font-size="${Math.max(18, Math.round(height * 0.026))}"
          font-family="Arial, sans-serif" font-weight="700" letter-spacing="1">
          MOCK · ${escapeXml(preset.name.toUpperCase())}
        </text>
      </svg>
    `);

    const output = await source
      .modulate({ saturation: 1.16, hue: preset.hue })
      .composite([{ input: overlay, blend: "soft-light" }])
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    return {
      bytes: output.data,
      contentType: "image/jpeg",
      width: output.info.width,
      height: output.info.height,
    };
  }
}

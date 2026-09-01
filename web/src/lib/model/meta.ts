import sharp from "sharp";

import type { ImageModelProvider, TransformInput, TransformResult } from "./types";

type ImageCandidate = {
  value: string;
  kind: "base64" | "url";
};

const base64Keys = new Set(["b64_json", "image_base64", "base64"]);
const urlKeys = new Set(["image_url", "url"]);

export function extractImageCandidate(payload: unknown): ImageCandidate | null {
  const seen = new Set<unknown>();

  function visit(value: unknown): ImageCandidate | null {
    if (!value || typeof value !== "object" || seen.has(value)) return null;
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const candidate = visit(item);
        if (candidate) return candidate;
      }
      return null;
    }

    const record = value as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (typeof child !== "string") continue;
      if (base64Keys.has(key) && child.length > 100) return { value: child, kind: "base64" };
      if (urlKeys.has(key) && (child.startsWith("https://") || child.startsWith("data:image/"))) {
        return { value: child, kind: "url" };
      }
    }

    for (const child of Object.values(record)) {
      const candidate = visit(child);
      if (candidate) return candidate;
    }
    return null;
  }

  return visit(payload);
}

async function candidateToBytes(candidate: ImageCandidate): Promise<{ bytes: Buffer; contentType: string }> {
  if (candidate.kind === "base64") {
    return { bytes: Buffer.from(candidate.value, "base64"), contentType: "image/png" };
  }

  if (candidate.value.startsWith("data:image/")) {
    const match = candidate.value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
    if (!match) throw new Error("Meta Model API returned an invalid data URL");
    return { bytes: Buffer.from(match[2], "base64"), contentType: match[1] };
  }

  const response = await fetch(candidate.value, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Unable to download generated image (${response.status})`);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") ?? "image/png",
  };
}

export class MetaMuseProvider implements ImageModelProvider {
  async transform({ bytes, preset }: TransformInput): Promise<TransformResult> {
    const endpoint = process.env.META_MODEL_API_URL;
    const apiKey = process.env.META_API_KEY;
    const model = process.env.META_MODEL_ID;

    if (!endpoint || !apiKey || !model) {
      throw new Error("Meta Model API is not fully configured");
    }

    const imageDataUrl = `data:image/jpeg;base64,${bytes.toString("base64")}`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: preset.prompt },
              { type: "input_image", image_url: imageDataUrl },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(240_000),
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`Meta Model API request failed (${response.status})`);
    }

    const candidate = extractImageCandidate(payload);
    if (!candidate) {
      throw new Error("Meta Model API response did not contain an image");
    }

    const image = await candidateToBytes(candidate);
    const metadata = await sharp(image.bytes).metadata();
    if (!metadata.width || !metadata.height) {
      throw new Error("Meta Model API returned an unreadable image");
    }

    return {
      ...image,
      width: metadata.width,
      height: metadata.height,
    };
  }
}

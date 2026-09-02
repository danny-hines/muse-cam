import sharp from "sharp";

import { ImageModelError, type ImageModelErrorCode } from "./errors";
import type { ImageModelProvider, TransformInput, TransformResult } from "./types";

export const DEFAULT_META_IMAGE_EDIT_URL = "https://api.meta.ai/v1/images/edits";
export const DEFAULT_META_IMAGE_MODEL = "muse-image-1.0";

type ImageCandidate = {
  value: string;
  kind: "base64" | "url";
  contentType: string;
};

const outputContentTypes: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function outputContentType(payload: Record<string, unknown>): string {
  const format = typeof payload.output_format === "string" ? payload.output_format : "webp";
  return outputContentTypes[format.toLowerCase()] ?? "image/webp";
}

export function extractImageCandidate(payload: unknown): ImageCandidate | null {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return null;

  const contentType = outputContentType(payload);
  for (const item of payload.data) {
    if (!isRecord(item)) continue;
    if (typeof item.b64_json === "string" && item.b64_json.length > 0) {
      return { value: item.b64_json, kind: "base64", contentType };
    }
    if (
      typeof item.url === "string" &&
      (item.url.startsWith("https://") || item.url.startsWith("data:image/"))
    ) {
      return { value: item.url, kind: "url", contentType };
    }
  }

  return null;
}

function metaErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.error)) return null;
  return typeof payload.error.message === "string" ? payload.error.message : null;
}

function metaErrorCode(status: number, detail: string | null): ImageModelErrorCode {
  if (status === 429) return "model_rate_limited";
  if (status >= 500) return "model_unavailable";
  if (status === 400 && detail && /filtered|content management policy/i.test(detail)) {
    return "content_filtered";
  }
  return "model_request_failed";
}

async function candidateToBytes(candidate: ImageCandidate): Promise<{ bytes: Buffer; contentType: string }> {
  if (candidate.kind === "base64") {
    return { bytes: Buffer.from(candidate.value, "base64"), contentType: candidate.contentType };
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
    contentType: response.headers.get("content-type")?.split(";", 1)[0] ?? candidate.contentType,
  };
}

export class MetaMuseProvider implements ImageModelProvider {
  async transform({ bytes, contentType, preset }: TransformInput): Promise<TransformResult> {
    const endpoint = process.env.META_MODEL_API_URL || DEFAULT_META_IMAGE_EDIT_URL;
    const apiKey = process.env.META_API_KEY;
    const model = process.env.META_MODEL_ID || DEFAULT_META_IMAGE_MODEL;

    if (!apiKey) {
      throw new Error("Meta Model API is not configured: META_API_KEY is required");
    }

    const imageDataUrl = `data:${contentType};base64,${bytes.toString("base64")}`;
    const deviceId = process.env.DEVICE_ID;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        prompt: preset.prompt,
        images: [{ image_url: imageDataUrl }],
        n: 1,
        response_format: "b64_json",
        output_format: "jpeg",
        reasoning_strength: "low",
        tool_enablement: {
          enable_image_search: false,
          enable_web_search: false,
          enable_shell: false,
        },
        ...(deviceId ? { user: deviceId } : {}),
      }),
      signal: AbortSignal.timeout(240_000),
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = metaErrorMessage(payload);
      throw new ImageModelError(
        metaErrorCode(response.status, detail),
        `Meta Model API request failed (${response.status})${detail ? `: ${detail}` : ""}`,
        response.status,
      );
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

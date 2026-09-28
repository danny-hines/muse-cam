import sharp from "sharp";

import type { Preset } from "@/config/presets";

export const DEFAULT_META_CHAT_URL = "https://api.meta.ai/v1/chat/completions";
export const DEFAULT_META_CAPTION_MODEL = "muse-spark-1.3";

const MAX_CAPTION_LENGTH = 160;

export const captionInstructions = `Someone shared this photo with the message "caption this." Reply with your caption.

The photo was taken at a live event with Muse Cam, a camera that restyles every shot. The people in it are real guests, and your caption appears under the photo in a public gallery.

Be genuinely funny, like the witty friend in the group chat. Riff on what is specifically happening in this image: an expression, a pose, a prop, or the absurdity the restyle created. Short and punchy beats clever and long.

Rules:
- Under 12 words, one line. No hashtags, emoji, or surrounding quotation marks.
- Good-natured and safe for work. Never joke about anyone's body, weight, age, looks, race, gender, or disability.
- Don't assume anyone's gender: no he, she, guy, or lady.
- Don't mention AI, filters, the event, or the style name.`;

export type CaptionInput = {
  bytes: Buffer;
  preset: Preset;
};

export interface CaptionModelProvider {
  caption(input: CaptionInput): Promise<string>;
}

type ChatCompletion = {
  choices?: { message?: { content?: unknown } }[];
  error?: { message?: unknown };
};

// Models occasionally add a label or wrap the reply in quotes despite the instructions.
export function cleanCaption(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const line = text.split("\n").map((value) => value.trim()).find(Boolean) ?? "";
  const caption = line
    .replace(/^caption\s*:\s*/i, "")
    .replace(/^["“'‘](.*)["”'’]$/s, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return caption && caption.length <= MAX_CAPTION_LENGTH ? caption : null;
}

export class MetaSparkCaptioner implements CaptionModelProvider {
  async caption({ bytes, preset }: CaptionInput): Promise<string> {
    const apiKey = process.env.META_API_KEY;
    if (!apiKey) {
      throw new Error("Meta Model API is not configured: META_API_KEY is required");
    }

    // A smaller copy is plenty to get the joke and keeps the request quick.
    const image = await sharp(bytes)
      .resize({ width: 1_024, height: 1_024, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    const response = await fetch(DEFAULT_META_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.META_CAPTION_MODEL_ID || DEFAULT_META_CAPTION_MODEL,
        // Higher effort was slower without being funnier, and sometimes spent the whole budget reasoning.
        reasoning_effort: "low",
        max_completion_tokens: 4_000,
        messages: [
          { role: "system", content: captionInstructions },
          {
            role: "user",
            content: [
              { type: "text", text: `Style: ${preset.name}. ${preset.description}` },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image.toString("base64")}` } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });

    const payload = (await response.json().catch(() => null)) as ChatCompletion | null;
    if (!response.ok) {
      const detail = typeof payload?.error?.message === "string" ? `: ${payload.error.message}` : "";
      throw new Error(`Muse Spark caption request failed (${response.status})${detail}`);
    }

    const caption = cleanCaption(payload?.choices?.[0]?.message?.content);
    if (!caption) throw new Error("Muse Spark did not return a usable caption");
    return caption;
  }
}

export class MockCaptioner implements CaptionModelProvider {
  async caption({ preset }: CaptionInput): Promise<string> {
    return `Mock caption · ${preset.name}`;
  }
}

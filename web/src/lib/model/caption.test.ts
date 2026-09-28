import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getPreset } from "@/config/presets";

import {
  captionInstructions,
  cleanCaption,
  DEFAULT_META_CAPTION_MODEL,
  DEFAULT_META_CHAT_URL,
  MetaSparkCaptioner,
} from "./caption";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("caption cleanup", () => {
  it("keeps a plain caption", () => {
    expect(cleanCaption("Stepped on a Lego, became a Lego.")).toBe("Stepped on a Lego, became a Lego.");
  });

  it("removes labels, wrapping quotes, extra lines, and stray whitespace", () => {
    expect(cleanCaption('Caption: "Filed under:   overdressed for leg day."\n\nHope that works!'))
      .toBe("Filed under: overdressed for leg day.");
    expect(cleanCaption("“Invented the selfie back in 1624”")).toBe("Invented the selfie back in 1624");
  });

  it("keeps quotation marks that are part of the joke", () => {
    expect(cleanCaption("Nobody said 'cardio' was optional")).toBe("Nobody said 'cardio' was optional");
  });

  it("rejects empty, missing, or runaway replies", () => {
    expect(cleanCaption("")).toBeNull();
    expect(cleanCaption(null)).toBeNull();
    expect(cleanCaption("word ".repeat(60))).toBeNull();
  });
});

describe("MetaSparkCaptioner", () => {
  const preset = getPreset("kid-drawing")!;

  async function photo(width = 2_048, height = 1_536) {
    return sharp({ create: { width, height, channels: 3, background: "#e26f55" } }).jpeg().toBuffer();
  }

  function reply(body: unknown, status = 200) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Response.json(body, { status });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends a downsized copy of the result to Muse Spark and returns its caption", async () => {
    vi.stubEnv("META_API_KEY", "test-meta-key");
    vi.stubEnv("META_CAPTION_MODEL_ID", "");
    const fetchMock = reply({ choices: [{ message: { content: "Commissioned portrait, paid in fruit snacks." } }] });

    const caption = await new MetaSparkCaptioner().caption({ bytes: await photo(), preset });

    expect(caption).toBe("Commissioned portrait, paid in fruit snacks.");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DEFAULT_META_CHAT_URL);
    expect(init?.headers).toEqual({ Authorization: "Bearer test-meta-key", "Content-Type": "application/json" });
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ model: DEFAULT_META_CAPTION_MODEL, reasoning_effort: "low" });
    expect(body.messages[0]).toEqual({ role: "system", content: captionInstructions });
    const [context, image] = body.messages[1].content;
    expect(context).toEqual({ type: "text", text: `Style: ${preset.name}. ${preset.description}` });
    const sent = Buffer.from(image.image_url.url.replace(/^data:image\/jpeg;base64,/, ""), "base64");
    expect(await sharp(sent).metadata()).toMatchObject({ format: "jpeg", width: 1_024, height: 768 });
  });

  it("uses the configured caption model", async () => {
    vi.stubEnv("META_API_KEY", "test-meta-key");
    vi.stubEnv("META_CAPTION_MODEL_ID", "muse-spark-next");
    const fetchMock = reply({ choices: [{ message: { content: "A caption" } }] });

    await new MetaSparkCaptioner().caption({ bytes: await photo(4, 3), preset });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).model).toBe("muse-spark-next");
  });

  it("fails when reasoning uses the whole budget and no caption comes back", async () => {
    vi.stubEnv("META_API_KEY", "test-meta-key");
    reply({ choices: [{ finish_reason: "length", message: { content: null } }] });

    await expect(new MetaSparkCaptioner().caption({ bytes: await photo(4, 3), preset }))
      .rejects.toThrow("did not return a usable caption");
  });

  it("surfaces the provider's error message", async () => {
    vi.stubEnv("META_API_KEY", "test-meta-key");
    reply({ error: { message: "Rate limit exceeded" } }, 429);

    await expect(new MetaSparkCaptioner().caption({ bytes: await photo(4, 3), preset }))
      .rejects.toThrow("Muse Spark caption request failed (429): Rate limit exceeded");
  });

  it("requires an API key", async () => {
    vi.stubEnv("META_API_KEY", "");
    await expect(new MetaSparkCaptioner().caption({ bytes: await photo(4, 3), preset }))
      .rejects.toThrow("META_API_KEY is required");
  });
});

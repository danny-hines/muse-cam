import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { presets } from "@/config/presets";

import {
  DEFAULT_META_IMAGE_EDIT_URL,
  DEFAULT_META_IMAGE_MODEL,
  extractImageCandidate,
  MetaMuseProvider,
} from "./meta";
import { ImageModelError } from "./errors";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Meta image response parsing", () => {
  it("finds a base64 image and uses the response output format", () => {
    const value = "a".repeat(120);
    expect(extractImageCandidate({ data: [{ b64_json: value }], output_format: "jpeg" })).toEqual({
      value,
      kind: "base64",
      contentType: "image/jpeg",
    });
  });

  it("finds a generated image URL", () => {
    expect(
      extractImageCandidate({ data: [{ url: "https://images.test/result.png" }], output_format: "png" }),
    ).toEqual({ value: "https://images.test/result.png", kind: "url", contentType: "image/png" });
  });

  it("ignores values outside the documented images response shape", () => {
    expect(extractImageCandidate({ output: [{ result: "a".repeat(120) }] })).toBeNull();
  });
});

describe("MetaMuseProvider", () => {
  it("sends a one-shot image edit using Meta's documented defaults", async () => {
    vi.stubEnv("META_API_KEY", "test-meta-key");
    vi.stubEnv("META_MODEL_API_URL", "");
    vi.stubEnv("META_MODEL_ID", "");
    vi.stubEnv("DEVICE_ID", "muse-cam-test");

    const input = await sharp({
      create: { width: 3, height: 2, channels: 3, background: "#e26f55" },
    })
      .jpeg()
      .toBuffer();
    const output = await sharp({
      create: { width: 6, height: 4, channels: 3, background: "#334455" },
    })
      .jpeg()
      .toBuffer();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return Response.json({
        data: [{ b64_json: output.toString("base64") }],
        output_format: "jpeg",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new MetaMuseProvider().transform({
      bytes: input,
      contentType: "image/jpeg",
      preset: presets[0],
    });

    expect(result).toMatchObject({ contentType: "image/jpeg", width: 6, height: 4 });
    expect(result.bytes.equals(output)).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(DEFAULT_META_IMAGE_EDIT_URL);
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      Authorization: "Bearer test-meta-key",
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: DEFAULT_META_IMAGE_MODEL,
      prompt: presets[0].prompt,
      n: 1,
      response_format: "b64_json",
      output_format: "jpeg",
      reasoning_strength: "low",
      user: "muse-cam-test",
      tool_enablement: {
        enable_image_search: false,
        enable_web_search: false,
        enable_shell: false,
      },
    });
    expect(body.images).toHaveLength(1);
    expect(body.images[0].image_url).toBe(`data:image/jpeg;base64,${input.toString("base64")}`);
  });

  it("surfaces the provider's structured error message", async () => {
    vi.stubEnv("META_API_KEY", "test-meta-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { type: "invalid_request_error", message: "The image was malformed." } },
          { status: 400 },
        ),
      ),
    );

    await expect(
      new MetaMuseProvider().transform({
        bytes: Buffer.from("not-used-by-the-mock"),
        contentType: "image/jpeg",
        preset: presets[0],
      }),
    ).rejects.toThrow("Meta Model API request failed (400): The image was malformed.");
  });

  it("classifies Meta content-policy filtering", async () => {
    vi.stubEnv("META_API_KEY", "test-meta-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: {
              message:
                "The response was filtered due to the prompt triggering our content management policy.",
            },
          },
          { status: 400 },
        ),
      ),
    );

    const operation = new MetaMuseProvider().transform({
      bytes: Buffer.from("not-used-by-the-mock"),
      contentType: "image/jpeg",
      preset: presets[0],
    });

    await expect(operation).rejects.toBeInstanceOf(ImageModelError);
    await expect(operation).rejects.toMatchObject({ code: "content_filtered", providerStatus: 400 });
  });
});

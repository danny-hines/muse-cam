import { describe, expect, it } from "vitest";

import { extractImageCandidate } from "./meta";

describe("Meta image response parsing", () => {
  it("finds a nested base64 image", () => {
    const value = "a".repeat(120);
    expect(
      extractImageCandidate({ output: [{ content: [{ type: "output_image", b64_json: value }] }] }),
    ).toEqual({ value, kind: "base64" });
  });

  it("finds a nested generated image URL", () => {
    expect(
      extractImageCandidate({ output: [{ content: [{ image_url: "https://images.test/result.png" }] }] }),
    ).toEqual({ value: "https://images.test/result.png", kind: "url" });
  });

  it("ignores unrelated short values", () => {
    expect(extractImageCandidate({ id: "response-1", url: "/relative/path" })).toBeNull();
  });
});

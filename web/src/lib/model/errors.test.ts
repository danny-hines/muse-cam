import { describe, expect, it } from "vitest";

import { classifyGenerationError, ImageModelError } from "./errors";

describe("generation error classification", () => {
  it("maps provider policy filters to an actionable client error", () => {
    const result = classifyGenerationError(
      new ImageModelError("content_filtered", "provider detail", 400),
    );

    expect(result).toEqual({
      code: "content_filtered",
      message: "This photo could not be transformed with that preset",
      status: 422,
    });
  });

  it("maps timeouts and rate limits to retryable HTTP statuses", () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";

    expect(classifyGenerationError(timeout)).toMatchObject({
      code: "model_timeout",
      status: 504,
    });
    expect(
      classifyGenerationError(new ImageModelError("model_rate_limited", "busy", 429)),
    ).toMatchObject({ code: "model_rate_limited", status: 503 });
  });
});

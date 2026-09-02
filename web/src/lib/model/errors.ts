export type ImageModelErrorCode =
  | "content_filtered"
  | "model_rate_limited"
  | "model_request_failed"
  | "model_unavailable";

export class ImageModelError extends Error {
  constructor(
    readonly code: ImageModelErrorCode,
    message: string,
    readonly providerStatus: number,
  ) {
    super(message);
    this.name = "ImageModelError";
  }
}

export type GenerationError = {
  code: ImageModelErrorCode | "model_timeout" | "generation_failed";
  message: string;
  status: number;
};

export function classifyGenerationError(error: unknown): GenerationError {
  if (error instanceof ImageModelError) {
    if (error.code === "content_filtered") {
      return {
        code: error.code,
        message: "This photo could not be transformed with that preset",
        status: 422,
      };
    }
    if (error.code === "model_rate_limited") {
      return {
        code: error.code,
        message: "Image generation is temporarily busy",
        status: 503,
      };
    }
    return {
      code: error.code,
      message: "Image generation failed",
      status: 502,
    };
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return { code: "model_timeout", message: "Image generation timed out", status: 504 };
  }
  return { code: "generation_failed", message: "Image generation failed", status: 502 };
}

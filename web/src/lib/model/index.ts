import { MetaMuseProvider } from "./meta";
import { MockImageProvider } from "./mock";
import type { ImageModelProvider } from "./types";

let provider: ImageModelProvider | null = null;

export function configuredModelProvider(): "meta" | "mock" {
  return process.env.MODEL_PROVIDER === "meta" ? "meta" : "mock";
}

export function getImageModelProvider(): ImageModelProvider {
  if (!provider) {
    provider = configuredModelProvider() === "meta" ? new MetaMuseProvider() : new MockImageProvider();
  }
  return provider;
}

export type { ImageModelProvider, TransformResult } from "./types";

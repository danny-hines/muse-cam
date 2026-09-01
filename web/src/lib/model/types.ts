import type { Preset } from "@/config/presets";

export type TransformInput = {
  bytes: Buffer;
  contentType: string;
  preset: Preset;
};

export type TransformResult = {
  bytes: Buffer;
  contentType: string;
  width: number;
  height: number;
};

export interface ImageModelProvider {
  transform(input: TransformInput): Promise<TransformResult>;
}

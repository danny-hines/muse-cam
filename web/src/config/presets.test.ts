import { describe, expect, it } from "vitest";

import { getPreset, presets } from "./presets";

describe("preset catalog", () => {
  it("contains unique ids", () => {
    expect(new Set(presets.map(({ id }) => id)).size).toBe(presets.length);
  });

  it("resolves a known preset", () => {
    expect(getPreset("alien-visitor")?.name).toBe("First Contact");
  });
});

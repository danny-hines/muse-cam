import { describe, expect, it } from "vitest";

import { getPreset, presets } from "./presets";

describe("preset catalog", () => {
  it("contains unique ids", () => {
    expect(new Set(presets.map(({ id }) => id)).size).toBe(presets.length);
  });

  it("resolves a known preset", () => {
    expect(getPreset("alien-visitor")?.name).toBe("First Contact");
  });

  it("uses the portrait-safe version of After the End", () => {
    const preset = getPreset("post-apocalypse");

    expect(preset?.version).toBe(2);
    expect(preset?.prompt).not.toMatch(/civilization collapsed|post-apocalyptic/i);
    expect(preset?.prompt).toContain("Do not add weapons, violence, gore, or disaster victims");
  });
});

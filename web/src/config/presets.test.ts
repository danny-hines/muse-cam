import { describe, expect, it } from "vitest";

import { getPreset, presets } from "./presets";

describe("preset catalog", () => {
  it("contains unique ids", () => {
    expect(new Set(presets.map(({ id }) => id)).size).toBe(presets.length);
  });

  it("resolves a known preset", () => {
    expect(getPreset("alien-visitor")?.name).toBe("First Contact");
  });

  it("versions the revised scene prompts independently of the unchanged styles", () => {
    const preset = getPreset("post-apocalypse");

    expect(preset?.version).toBe(3);
    expect(getPreset("alien-visitor")?.version).toBe(2);
    for (const id of ["kid-drawing", "claymation", "disposable-90s", "storybook"]) {
      expect(getPreset(id)?.version).toBe(1);
    }
  });
});

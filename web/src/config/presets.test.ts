import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getPreset, presets } from "./presets";
import { GET } from "@/app/api/device/presets/route";

describe("preset catalog", () => {
  it("contains unique ids", () => {
    expect(new Set(presets.map(({ id }) => id)).size).toBe(presets.length);
  });

  it("resolves a known preset", () => {
    expect(getPreset("alien-visitor")?.name).toBe("First Contact");
  });

  it("ships the same public catalog to the API and the offline device", async () => {
    const response = GET();
    const { presets: publicPresets } = await response.json();
    const bundled = JSON.parse(
      readFileSync(new URL("../../../device/src/musecam/presets.json", import.meta.url), "utf8"),
    );

    expect(bundled).toEqual(publicPresets);
    expect(publicPresets).toHaveLength(presets.length);
    for (const preset of publicPresets) {
      expect(Object.keys(preset).sort()).toEqual(["accent", "description", "id", "name", "version"]);
      expect(getPreset(preset.id)).toBeDefined();
    }
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

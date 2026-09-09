import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getPreset, presets, retiredPresets } from "./presets";
import { GET } from "@/app/api/device/presets/route";

describe("preset catalog", () => {
  it("contains unique ids", () => {
    const all = [...presets, ...retiredPresets];
    expect(new Set(all.map(({ id }) => id)).size).toBe(all.length);
  });

  it("keeps retired photo styles resolvable without advertising them", () => {
    const bundled = JSON.parse(
      readFileSync(new URL("../../../device/src/musecam/retired-presets.json", import.meta.url), "utf8"),
    );
    expect(bundled).toEqual(retiredPresets.map(({ id, version, name, description, accent }) => ({
      id, version, name, description, accent,
    })));
    for (const retired of retiredPresets) {
      expect(presets.some(({ id }) => id === retired.id)).toBe(false);
      expect(getPreset(retired.id)).toEqual(retired);
    }
  });

  it("keeps renamed style IDs stable and versions changed prompts", () => {
    expect(getPreset("after-school")).toMatchObject({ name: "Anime Cel", version: 1 });
    expect(getPreset("big-screen")).toMatchObject({ name: "3D Toon", version: 1 });
    expect(getPreset("pocket-arcade")).toMatchObject({ name: "Title Screen", version: 1 });
    expect(getPreset("memory-card")).toMatchObject({ name: "Insert Disc 2", version: 2 });
    expect(getPreset("age-of-legends")?.version).toBe(2);
    expect(presets.some(({ id }) => id === "player-one")).toBe(true);
  });

  it("resolves a known preset", () => {
    expect(getPreset("alien-visitor")?.name).toBe("First Contact");
  });

  it("keeps the Disc 2 experiments separately selectable and limits the visual reference to its own mode", () => {
    for (const suffix of ["smooth", "wide", "smooth-wide", "1996", "reference"]) {
      expect(presets.find(({ id }) => id === `disc-2-${suffix}`)).toMatchObject({ version: 1 });
    }
    expect(getPreset("memory-card")).toMatchObject({ name: "Insert Disc 2", version: 2 });
    expect(presets.filter(({ referenceImage }) => referenceImage).map(({ id }) => id))
      .toEqual(["disc-2-reference"]);
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

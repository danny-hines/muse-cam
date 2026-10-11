import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  eventPresetIds,
  presetAllowedForEvent,
  presets,
  presetsForEvent,
  retiredPresets,
  styleCatalog,
  surpriseCandidates,
  surprisePreset,
} from "./presets";
import { deviceStyles } from "./device-styles";
import { GET } from "@/app/api/device/presets/route";
import { loadExampleEventStyle } from "@/test/example-event-style";

const builtIn = styleCatalog([]);
const getPreset = (id: string) => builtIn.get(id);

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
    expect(getPreset("memory-card")).toMatchObject({ name: "Insert Disc 2", version: 3 });
    expect(getPreset("age-of-legends")?.version).toBe(2);
    expect(presets.some(({ id }) => id === "player-one")).toBe(true);
  });

  it("resolves a known preset", () => {
    expect(getPreset("alien-visitor")?.name).toBe("First Contact");
  });

  it("promotes Smooth+Wide and preserves retired Disc 2 experiments for saved photos", () => {
    for (const suffix of ["smooth", "wide", "smooth-wide", "1996", "reference"]) {
      const id = `disc-2-${suffix}`;
      expect(presets.some((preset) => preset.id === id)).toBe(false);
      expect(retiredPresets.find((preset) => preset.id === id)).toMatchObject({ version: 1 });
    }
    expect(presets.find(({ id }) => id === "memory-card"))
      .toMatchObject({ name: "Insert Disc 2", version: 3, prompt: getPreset("disc-2-smooth-wide")?.prompt });
    // Reference images belong to private event styles; no built-in style sends one.
    expect([...presets, ...retiredPresets].some(({ referenceImageRefs }) => referenceImageRefs)).toBe(false);
  });

  it("ships the same public catalog to the API and the offline device", async () => {
    const response = await GET(new Request("https://camera.test/api/device/presets"));
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

  it("bundles the public prompts for standalone cameras", () => {
    const bundled = JSON.parse(
      readFileSync(new URL("../../../device/src/musecam/standalone-presets.json", import.meta.url), "utf8"),
    );

    // Out of date? Run `pnpm --dir web styles:export`.
    expect(bundled).toEqual(deviceStyles());
    expect(bundled.map(({ id }: { id: string }) => id)).toEqual(presets.map(({ id }) => id));
    expect(bundled.every(({ prompt }: { prompt: string }) => prompt.length > 0)).toBe(true);
  });

  it("versions the revised scene prompts independently of the unchanged styles", () => {
    const preset = getPreset("post-apocalypse");

    expect(preset?.version).toBe(3);
    expect(getPreset("alien-visitor")?.version).toBe(2);
    for (const id of ["kid-drawing", "claymation", "storybook"]) {
      expect(getPreset(id)?.version).toBe(1);
    }
    expect(getPreset("disposable-90s")?.version).toBe(2);
  });
});

const special = await loadExampleEventStyle();
const catalog = styleCatalog([special]);

describe("event styles", () => {
  it("keeps event-only styles out of the default catalog", () => {
    expect(special).toMatchObject({ id: "party-hats", eventOnly: true });
    expect(presets.some(({ id }) => id === special.id)).toBe(false);
    expect(catalog.get(special.id)).toEqual(special);
    expect(builtIn.get(special.id)).toBeUndefined();
  });

  it("never lets a private style replace a built-in one", () => {
    const imposter = styleCatalog([{ ...special, id: "kid-drawing", name: "Imposter" }]);
    expect(imposter.get("kid-drawing")).toEqual(getPreset("kid-drawing"));
    expect(imposter.selectable.filter(({ id }) => id === "kid-drawing")).toHaveLength(1);
  });

  it("gives events without a choice the default catalog", () => {
    expect(presetsForEvent(catalog, null)).toBe(presets);
    expect(presetsForEvent(catalog, { presetIds: null })).toBe(presets);
    expect(presetsForEvent(catalog, { presetIds: ["retired-or-removed"] })).toBe(presets);
  });

  it("lists an event's styles with event-only styles first", () => {
    expect(presetsForEvent(catalog, { presetIds: ["kid-drawing", special.id, "cartridge-world"] }).map(({ id }) => id))
      .toEqual([special.id, "kid-drawing"]);
  });

  it("limits event-only styles to events that enable them, but not default styles", () => {
    const kidDrawing = getPreset("kid-drawing")!;
    expect(presetAllowedForEvent(kidDrawing, null)).toBe(true);
    expect(presetAllowedForEvent(kidDrawing, { presetIds: [special.id] })).toBe(true);
    expect(presetAllowedForEvent(special, null)).toBe(false);
    expect(presetAllowedForEvent(special, { presetIds: null })).toBe(false);
    expect(presetAllowedForEvent(special, { presetIds: ["kid-drawing"] })).toBe(false);
    expect(presetAllowedForEvent(special, { presetIds: [special.id] })).toBe(true);
  });

  it("stores the default selection as null so new default styles still appear", () => {
    expect(eventPresetIds(catalog, presets.map(({ id }) => id))).toBeNull();
    expect(eventPresetIds(catalog, [])).toEqual([]);
    expect(eventPresetIds(catalog, [...presets.map(({ id }) => id), special.id])).toHaveLength(presets.length + 1);
    expect(eventPresetIds(catalog, presets.slice(1).map(({ id }) => id))).toHaveLength(presets.length - 1);
  });

  it("shuffles an event's styles for a surprise photo", () => {
    const presetIds = ["kid-drawing", special.id, "claymation"];
    const ids = (random: () => number) => surpriseCandidates(catalog, { presetIds }, [], random).map(({ id }) => id);
    expect(ids(() => 0).sort()).toEqual([...presetIds].sort());
    expect(ids(() => 0)).not.toEqual(ids(() => 0.99));
    expect(surpriseCandidates(catalog, null)).toHaveLength(presets.length);
    expect(catalog.get(surprisePreset.id)).toBeUndefined();
  });

  it("puts a camera's unused styles first, then the ones it used longest ago", () => {
    const presetIds = ["kid-drawing", special.id, "claymation", "storybook"];
    const recent = ["claymation", "kid-drawing"];
    for (const random of [() => 0, () => 0.5, () => 0.99]) {
      const ids = surpriseCandidates(catalog, { presetIds }, recent, random).map(({ id }) => id);
      expect(ids.slice(0, 2).sort()).toEqual([special.id, "storybook"].sort());
      expect(ids.slice(2)).toEqual(["kid-drawing", "claymation"]);
    }
  });
});

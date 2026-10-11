import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getFleetRepository } from "@/lib/fleet";
import { getMediaStore } from "@/lib/media";
import { exampleEventStylesFolder } from "@/test/example-event-style";
import { getStyleCatalog, loadEventStyles } from "./styles";

vi.mock("@/lib/fleet", async () => {
  const { MemoryFleetRepository } = await import("@/lib/fleet/memory");
  const repository = new MemoryFleetRepository();
  return { getFleetRepository: () => repository };
});
vi.mock("@/lib/media", async () => {
  const { MemoryMediaStore } = await import("@/lib/media/memory");
  const media = new MemoryMediaStore();
  return { getMediaStore: () => media };
});

let folder: string;

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "event-styles-"));
  await cp(exampleEventStylesFolder, folder, { recursive: true });
});

async function editStyles(edit: (style: Record<string, unknown>) => Record<string, unknown>) {
  const file = path.join(folder, "styles.json");
  const { styles } = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ styles: styles.map(edit) }));
}

describe("loading event-only styles", () => {
  it("checks a folder without saving anything on a dry run", async () => {
    expect(await loadEventStyles(folder, { dryRun: true }))
      .toEqual([{ id: "party-hats", version: 1, referenceImages: 1 }]);
    expect(await getFleetRepository().listEventStyles()).toEqual([]);
  });

  it("stores the example style as private config with its reference image", async () => {
    await loadEventStyles(folder);
    const style = (await getStyleCatalog()).get("party-hats");
    expect(style).toMatchObject({ name: "Party Hats", version: 1, eventOnly: true });
    expect(style?.referenceImageRefs).toHaveLength(1);
    const reference = await getMediaStore().readPrivate(style!.referenceImageRefs![0]);
    expect(reference.bytes.equals(await readFile(path.join(folder, "party-hat.jpg")))).toBe(true);
    expect(reference.contentType).toBe("image/jpeg");
  });

  it("replaces a style with the same ID and drops reference images it no longer uses", async () => {
    await loadEventStyles(folder);
    const [oldRef] = (await getStyleCatalog()).get("party-hats")!.referenceImageRefs!;
    await editStyles((style) => ({ ...style, version: 2, referenceImages: undefined }));
    await loadEventStyles(folder);
    const style = (await getStyleCatalog()).get("party-hats");
    expect(style).toMatchObject({ version: 2 });
    expect(style?.referenceImageRefs).toBeUndefined();
    await expect(getMediaStore().readPrivate(oldRef)).rejects.toThrow("not found");
  });

  it("refuses built-in IDs, missing images, and other formats before writing", async () => {
    const save = vi.spyOn(getFleetRepository(), "saveEventStyle");
    await editStyles((style) => ({ ...style, id: "kid-drawing" }));
    await expect(loadEventStyles(folder)).rejects.toThrow("kid-drawing is already a built-in style");
    await editStyles((style) => ({ ...style, id: "party-hats", referenceImages: ["missing.jpg"] }));
    await expect(loadEventStyles(folder)).rejects.toThrow("ENOENT");
    await sharp(path.join(folder, "party-hat.jpg")).png().toFile(path.join(folder, "hat.png"));
    await editStyles((style) => ({ ...style, referenceImages: ["hat.png"] }));
    await expect(loadEventStyles(folder)).rejects.toThrow("hat.png must be a JPEG");
    await editStyles((style) => ({ ...style, referenceImages: ["party-hat.jpg"], extra: true }));
    await expect(loadEventStyles(folder)).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
});

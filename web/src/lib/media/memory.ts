import type { MediaObject, MediaStore } from "./types";

type MemoryMediaState = {
  privateObjects: Map<string, MediaObject>;
};

const globalMemory = globalThis as typeof globalThis & {
  __museCamMemoryMedia?: MemoryMediaState;
};

function getState(): MemoryMediaState {
  if (!globalMemory.__museCamMemoryMedia) {
    globalMemory.__museCamMemoryMedia = { privateObjects: new Map() };
  }

  return globalMemory.__museCamMemoryMedia;
}

export class MemoryMediaStore implements MediaStore {
  async storePrivate(
    kind: "originals" | "results",
    id: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<string> {
    const ref = `memory://${kind}/${id}`;
    getState().privateObjects.set(ref, { bytes, contentType });
    return ref;
  }

  async readPrivate(ref: string): Promise<MediaObject> {
    const object = getState().privateObjects.get(ref);
    if (!object) {
      throw new Error(`Private media ${ref} was not found`);
    }
    return object;
  }

  async publish(ref: string): Promise<string> {
    const object = await this.readPrivate(ref);
    return `data:${object.contentType};base64,${object.bytes.toString("base64")}`;
  }

  async removePublic(): Promise<void> {
    // Data URLs have no separately persisted public object.
  }

  async removePrivate(ref: string): Promise<void> {
    getState().privateObjects.delete(ref);
  }
}

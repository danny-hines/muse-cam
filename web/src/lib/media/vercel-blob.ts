import { del, put } from "@vercel/blob";

import type { MediaObject, MediaStore } from "./types";

function requiredToken(name: "PRIVATE_BLOB_READ_WRITE_TOKEN" | "PUBLIC_BLOB_READ_WRITE_TOKEN") {
  const token = process.env[name];
  if (!token) {
    throw new Error(`${name} is not configured`);
  }
  return token;
}

function extensionFor(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}

export class VercelBlobMediaStore implements MediaStore {
  async storePrivate(
    kind: "originals" | "results",
    id: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<string> {
    const extension = extensionFor(contentType);
    const blob = await put(`${kind}/${id}.${extension}`, bytes, {
      access: "private",
      addRandomSuffix: true,
      contentType,
      token: requiredToken("PRIVATE_BLOB_READ_WRITE_TOKEN"),
    });
    return blob.url;
  }

  async readPrivate(ref: string): Promise<MediaObject> {
    const response = await fetch(ref, {
      headers: {
        Authorization: `Bearer ${requiredToken("PRIVATE_BLOB_READ_WRITE_TOKEN")}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Unable to read private blob (${response.status})`);
    }

    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "image/jpeg",
    };
  }

  async publish(ref: string, id: string, contentType: string): Promise<string> {
    const object = await this.readPrivate(ref);
    const extension = extensionFor(contentType);
    const blob = await put(`shared/${id}.${extension}`, object.bytes, {
      access: "public",
      addRandomSuffix: true,
      contentType,
      token: requiredToken("PUBLIC_BLOB_READ_WRITE_TOKEN"),
    });
    return blob.url;
  }

  async removePublic(ref: string): Promise<void> {
    await del(ref, { token: requiredToken("PUBLIC_BLOB_READ_WRITE_TOKEN") });
  }
}

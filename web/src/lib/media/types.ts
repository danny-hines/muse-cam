export type MediaObject = {
  bytes: Buffer;
  contentType: string;
};

export interface MediaStore {
  storePrivate(
    kind: "originals" | "results",
    id: string,
    bytes: Buffer,
    contentType: string,
  ): Promise<string>;
  readPrivate(ref: string): Promise<MediaObject>;
  publish(ref: string, id: string, contentType: string): Promise<string>;
  removePublic(ref: string): Promise<void>;
  removePrivate(ref: string): Promise<void>;
}

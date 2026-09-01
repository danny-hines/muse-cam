import sharp from "sharp";

export const MAX_IMAGE_BYTES = 2_500_000;
export const MAX_IMAGE_EDGE = 2_048;

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export class InvalidImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidImageError";
  }
}

export async function normalizeInputImage(file: File): Promise<Buffer> {
  if (!acceptedTypes.has(file.type)) {
    throw new InvalidImageError("Use a JPEG, PNG, or WebP image");
  }

  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new InvalidImageError(`Image must be smaller than ${MAX_IMAGE_BYTES} bytes`);
  }

  try {
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { failOn: "error", limitInputPixels: 40_000_000 });
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw new InvalidImageError("Image dimensions could not be read");
    }

    return image
      .rotate()
      .resize({
        width: MAX_IMAGE_EDGE,
        height: MAX_IMAGE_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    if (error instanceof InvalidImageError) throw error;
    throw new InvalidImageError("The uploaded file is not a readable image");
  }
}

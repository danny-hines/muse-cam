export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

function coverSize(view: Size, image: Size): Size {
  const scale = Math.max(view.width / image.width, view.height / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

// Match the centered object-fit: cover used by the live MJPEG image.
export function previewPoint(point: Point, view: Size, image: Size): Point {
  const cover = coverSize(view, image);
  return {
    x: clamp((point.x + (cover.width - view.width) / 2) / cover.width, 0, 1),
    y: clamp((point.y + (cover.height - view.height) / 2) / cover.height, 0, 1),
  };
}

export function focusMarker(point: Point, view: Size, image: Size): Point {
  const cover = coverSize(view, image);
  return {
    x: clamp(point.x * cover.width - (cover.width - view.width) / 2, 65, view.width - 65),
    y: clamp(point.y * cover.height - (cover.height - view.height) / 2, 36, view.height - 64),
  };
}

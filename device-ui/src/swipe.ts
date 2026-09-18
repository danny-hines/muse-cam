export function swipeDirection({
  dx, dy, elapsedMs, startScale, endScale,
}: {
  dx: number;
  dy: number;
  elapsedMs: number;
  startScale: number;
  endScale: number;
}): "previous" | "next" | null {
  if (startScale > 1.01 || endScale > 1.01 || elapsedMs > 900 ||
    Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? "next" : "previous";
}

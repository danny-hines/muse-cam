import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type Point = { x: number; y: number };
type View = Point & { scale: number };
const FIT: View = { x: 0, y: 0, scale: 1 };
const MAX_ZOOM = 4;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

export function PhotoViewer({
  sourceUrl,
  resultUrl,
  original,
  disabled,
  onCompare,
}: {
  sourceUrl: string;
  resultUrl: string | null;
  original: boolean;
  disabled: boolean;
  onCompare: (original: boolean) => void;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const imageSize = useRef({ width: 0, height: 0 });
  const [view, setView] = useState(FIT);
  const current = useRef(FIT);
  const pointers = useRef(new Map<number, Point>());
  const baseline = useRef({ points: [] as Point[], view: FIT });
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tap = useRef<{
    id: number;
    start: Point;
    time: number;
    moved: boolean;
    held: boolean;
  } | null>(null);
  const lastTap = useRef<{ point: Point; time: number } | null>(null);

  const cancelHold = useCallback(() => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    onCompare(false);
  }, [onCompare]);

  const rebase = useCallback(() => {
    baseline.current = {
      points: [...pointers.current.values()],
      view: current.current,
    };
  }, []);

  const apply = useCallback((next: View) => {
    const element = viewport.current;
    if (!element) return;
    const scale = Math.max(1, Math.min(MAX_ZOOM, next.scale));
    const { width, height } = imageSize.current;
    const fit = width && height
      ? Math.min(element.clientWidth / width, element.clientHeight / height)
      : 0;
    // Clamp to the painted photo, excluding object-fit's letterbox margins.
    const maxX = Math.max(0, (width * fit * scale - element.clientWidth) / 2);
    const maxY = Math.max(0, (height * fit * scale - element.clientHeight) / 2);
    const bounded = {
      scale,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
    current.current = bounded;
    setView(bounded);
  }, []);

  function zoomAt(scale: number, point: Point) {
    const before = current.current;
    const ratio = scale / before.scale;
    apply({
      scale,
      x: point.x - (point.x - before.x) * ratio,
      y: point.y - (point.y - before.y) * ratio,
    });
  }

  function point(event: ReactPointerEvent): Point {
    const rect = viewport.current!.getBoundingClientRect();
    return {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    };
  }

  const resetGesture = useCallback(() => {
    cancelHold();
    pointers.current.clear();
    tap.current = null;
    lastTap.current = null;
  }, [cancelHold]);

  useEffect(() => {
    const element = viewport.current!;
    const resize = new ResizeObserver(() => {
      apply(current.current);
      rebase();
    });
    resize.observe(element);
    window.addEventListener("blur", resetGesture);
    return () => {
      resize.disconnect();
      window.removeEventListener("blur", resetGesture);
      if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    };
  }, [apply, rebase, resetGesture]);

  useEffect(() => {
    if (disabled) resetGesture();
  }, [disabled, resetGesture]);

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    if (pointers.current.size >= 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = point(event);
    pointers.current.set(event.pointerId, start);
    rebase();
    cancelHold();
    if (pointers.current.size === 1) {
      tap.current = {
        id: event.pointerId, start, time: performance.now(), moved: false, held: false,
      };
      if (resultUrl) {
        holdTimer.current = setTimeout(() => {
          holdTimer.current = null;
          if (tap.current && !tap.current.moved && pointers.current.size === 1) {
            tap.current.held = true;
            lastTap.current = null;
            onCompare(true);
          }
        }, 350);
      }
    } else {
      tap.current = null;
      lastTap.current = null;
    }
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    const next = point(event);
    pointers.current.set(event.pointerId, next);
    if (tap.current && distance(tap.current.start, next) > 8) {
      tap.current.moved = true;
      lastTap.current = null;
      cancelHold();
    }
    const points = [...pointers.current.values()];
    const start = baseline.current;
    if (points.length === 2 && start.points.length === 2) {
      const from = midpoint(start.points[0], start.points[1]);
      const to = midpoint(points[0], points[1]);
      const scale = Math.max(1, Math.min(MAX_ZOOM,
        start.view.scale * distance(points[0], points[1]) /
          Math.max(1, distance(start.points[0], start.points[1])),
      ));
      const ratio = scale / start.view.scale;
      apply({
        scale,
        x: to.x - (from.x - start.view.x) * ratio,
        y: to.y - (from.y - start.view.y) * ratio,
      });
    } else if (points.length === 1 && start.points.length === 1 &&
      (!tap.current || tap.current.moved)) {
      apply({
        scale: start.view.scale,
        x: start.view.x + next.x - start.points[0].x,
        y: start.view.y + next.y - start.points[0].y,
      });
    }
  }

  function pointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    if (event.type !== "pointerup") lastTap.current = null;
    const candidate = tap.current;
    const now = performance.now();
    if (event.type === "pointerup" && candidate?.id === event.pointerId &&
      !candidate.moved && !candidate.held && now - candidate.time < 300 &&
      distance(candidate.start, point(event)) <= 8) {
      const previous = lastTap.current;
      if (previous && now - previous.time < 320 &&
        distance(previous.point, candidate.start) < 28) {
        if (current.current.scale > 1.01) apply(FIT);
        else zoomAt(2, candidate.start);
        lastTap.current = null;
      } else {
        lastTap.current = { point: candidate.start, time: now };
      }
    }
    cancelHold();
    tap.current = null;
    pointers.current.delete(event.pointerId);
    // The remaining finger starts panning from here, without a position jump.
    rebase();
  }

  return (
    <>
      <div
        ref={viewport}
        className={`photo-viewport${view.scale > 1.01 ? " zoomed" : ""}`}
        inert={disabled}
        role="region"
        aria-label="Photo viewer. Pinch or double-tap to zoom, drag to pan. Use plus, minus or zero on a keyboard."
        tabIndex={0}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onLostPointerCapture={pointerEnd}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (!["+", "=", "-", "0"].includes(event.key)) return;
          event.preventDefault();
          resetGesture();
          if (event.key === "0") apply(FIT);
          else zoomAt(Math.max(1, Math.min(MAX_ZOOM,
            current.current.scale * (event.key === "-" ? 1 / 1.5 : 1.5),
          )), { x: 0, y: 0 });
        }}
      >
        <img
          className="detail-image"
          src={original || !resultUrl ? sourceUrl : resultUrl}
          alt={original || !resultUrl ? "Original photograph" : "Imagined photograph"}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          onLoad={(event) => {
            // Keep the same framing while holding the original for comparison.
            if (original && resultUrl) return;
            imageSize.current = {
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            };
            apply(current.current);
          }}
        />
      </div>
      {view.scale > 1.01 && (
        <button
          className="glass-button photo-fit"
          inert={disabled}
          aria-label="Reset zoom to fit photo"
          onClick={() => { resetGesture(); apply(FIT); }}
        >
          {view.scale.toFixed(1)}× <span>· Fit</span>
        </button>
      )}
    </>
  );
}

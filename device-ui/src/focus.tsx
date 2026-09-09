import { useEffect, useRef, useState } from "react";
import type { CameraAction, FocusState } from "./types";
import { focusMarker, previewPoint, type Size } from "./focus-geometry";

const labels: Record<FocusState["status"], string> = {
  idle: "Focus unconfirmed",
  scanning: "Focusing",
  focused: "Focused",
  failed: "Try another area",
  unavailable: "Focus unconfirmed",
};

export function FocusTarget({ focus, previewSize, enabled, act, report }: {
  focus: FocusState;
  previewSize: Size;
  enabled: boolean;
  act: (action: CameraAction, values?: object) => Promise<unknown>;
  report: (message: string) => void;
}) {
  const surface = useRef<HTMLButtonElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; at: number } | null>(null);
  const [size, setSize] = useState(previewSize);
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const status = enabled ? focus.status : "unavailable";
  const marker = focus.point ? focusMarker(focus.point, size, previewSize) : null;
  return (
    <>
      <button
        ref={surface}
        type="button"
        className="focus-surface"
        aria-label="Focus on a subject"
        disabled={!enabled}
        onPointerDown={(event) => {
          if (!event.isPrimary || event.button !== 0) {
            gesture.current = null;
            return;
          }
          gesture.current = {
            id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(),
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = gesture.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10)
            gesture.current = null;
        }}
        onPointerCancel={() => { gesture.current = null; }}
        onLostPointerCapture={() => { gesture.current = null; }}
        onPointerUp={(event) => {
          const start = gesture.current;
          gesture.current = null;
          if (!enabled || !start || start.id !== event.pointerId || performance.now() - start.at > 650)
            return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const point = previewPoint(
            { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
            bounds, previewSize,
          );
          void act("focus", point).catch((error: Error) => report(error.message));
        }}
        onClick={(event) => {
          // Native keyboard activation focuses the center; pointer taps are handled above.
          if (event.detail === 0 && enabled)
            void act("focus", { x: 0.5, y: 0.5 }).catch((error: Error) => report(error.message));
        }}
      />
      {marker && (
        <div
          className={`focus-target ${status}`}
          style={{ left: marker.x, top: marker.y }}
          role="status"
          aria-live="polite"
        >
          <div className="focus-brackets" aria-hidden="true"><i /><i /><i /><i /></div>
          <span>{labels[status]}</span>
        </div>
      )}
    </>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import type { CameraScene, Colorway } from "./camera-scene";

const MODELS = {
  enclosure: "/models/muse-cam.bin",
  internals: "/models/muse-cam-internals.bin",
  reel: "/models/screen-reel.json",
};

export function CameraShowcase() {
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CameraScene | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [pinned, setPinned] = useState(false);
  const [colorway, setColorway] = useState<Colorway | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // A fresh canvas per mount keeps a remounted effect from sharing a WebGL context.
    const canvas = document.createElement("canvas");
    stage.append(canvas);
    let cancelled = false;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    import("./camera-scene")
      .then(({ createCameraScene }) =>
        createCameraScene(canvas, MODELS, {
          reducedMotion,
          onColorway: setColorway,
          onTap: () => setPinned((value) => !value),
        }),
      )
      .then((scene) => {
        if (cancelled) return scene.dispose();
        sceneRef.current = scene;
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      canvas.remove();
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setPinned(pinned);
  }, [pinned, status]);

  return (
    <figure className="camera-showcase" data-status={status}>
      <div
        className="camera-stage"
        ref={stageRef}
        role="img"
        aria-label="A 3D model of the Muse Cam enclosure, turning slowly"
      />
      <figcaption className="camera-caption">
        <span className="camera-colorway">
          {colorway ? (
            <>
              <span className="camera-swatches" aria-hidden="true">
                <span style={{ background: colorway.colors.front }} />
                <span style={{ background: colorway.colors.housing }} />
              </span>
              {colorway.name}
            </>
          ) : null}
        </span>
        <button type="button" aria-pressed={pinned} onClick={() => setPinned((value) => !value)}>
          {pinned ? "Put it back together" : "Take it apart"}
        </button>
      </figcaption>
    </figure>
  );
}

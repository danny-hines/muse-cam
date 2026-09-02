import { useEffect, type CSSProperties } from "react";

import type { CameraAction } from "./types";
import { useCamera } from "./use-camera";

const BUSY_STATUSES = new Set(["capturing", "processing", "sharing"]);

function CameraMark() {
  return (
    <span className="camera-mark" aria-hidden="true">
      <span />
    </span>
  );
}

function StatusOverlay({ status, message }: { status: string; message: string }) {
  if (!BUSY_STATUSES.has(status) && status !== "error") return null;

  const title =
    status === "capturing"
      ? "Hold that thought"
      : status === "processing"
        ? "Imagining"
        : status === "sharing"
          ? "Sending it out"
          : "Something wandered off";

  return (
    <div className={`status-overlay status-${status}`} role="status" aria-live="polite">
      {status !== "error" ? <span className="orbit" aria-hidden="true" /> : null}
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

function ActionButton({
  action,
  label,
  onAction,
  disabled = false,
  prominent = false,
}: {
  action: CameraAction;
  label: string;
  onAction: (action: CameraAction) => void;
  disabled?: boolean;
  prominent?: boolean;
}) {
  return (
    <button
      className={prominent ? "action-button shutter-button" : "action-button"}
      type="button"
      onClick={() => onAction(action)}
      disabled={disabled}
    >
      {prominent ? <span className="shutter-ring" aria-hidden="true" /> : null}
      <span>{label}</span>
    </button>
  );
}

export function App() {
  const { state, connected, act } = useCamera();
  const busy = BUSY_STATUSES.has(state.status);
  const showingResult = state.status === "result" || state.status === "sharing";
  const imageUrl = showingResult && state.resultUrl ? state.resultUrl : "/preview.mjpg";

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      const action =
        event.key === "ArrowLeft"
          ? "previous"
          : event.key === "ArrowRight"
            ? "next"
            : event.key === " " || event.key === "Enter"
              ? "capture"
              : event.key.toLowerCase() === "s"
                ? "share"
                : event.key === "Escape" || event.key === "Backspace"
                  ? "back"
                  : null;
      if (action) {
        event.preventDefault();
        void act(action);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [act]);

  return (
    <main className="camera-shell" style={{ "--accent": state.preset.accent } as CSSProperties}>
      <header className="top-bar">
        <div className="brand-lockup">
          <CameraMark />
          <span>Muse Cam</span>
        </div>
        <div className="camera-health" role="status" aria-label="Camera status">
          {state.queued > 0 ? <span>{state.queued} queued</span> : null}
          {state.battery !== null ? <span>{state.battery}%</span> : null}
          <span className={connected && state.networkOnline ? "online" : "offline"}>
            <i aria-hidden="true" />
            {connected && state.networkOnline ? "Ready" : "Offline"}
          </span>
        </div>
      </header>

      <section className="viewfinder" aria-label={showingResult ? "Transformed photo" : "Camera preview"}>
        <img className="camera-image" src={imageUrl} alt="" draggable={false} />
        <div className="viewfinder-shade" aria-hidden="true" />
        <div className="preset-card">
          <span className="preset-position">
            {String(state.presetIndex + 1).padStart(2, "0")} / {String(state.presetCount).padStart(2, "0")}
          </span>
          <div>
            <p>{showingResult ? (state.shared ? "Shared creation" : "Muse made") : "Current style"}</p>
            <h1>{state.preset.name}</h1>
          </div>
        </div>
        {showingResult ? (
          <button className="back-to-camera" type="button" onClick={() => void act("back")}>
            <span aria-hidden="true">←</span> Camera
          </button>
        ) : null}
        <StatusOverlay status={state.status} message={state.message} />
      </section>

      <nav className="control-deck" aria-label="Camera controls">
        <ActionButton action="previous" label="Previous" onAction={act} disabled={busy} />
        <ActionButton
          action="capture"
          label={showingResult ? "Again" : "Snap"}
          onAction={act}
          disabled={busy || state.status === "starting"}
          prominent
        />
        <ActionButton action="next" label="Next" onAction={act} disabled={busy} />
        <ActionButton
          action="share"
          label={state.shared ? "Shared" : "Share"}
          onAction={act}
          disabled={busy || !showingResult || state.shared}
        />
      </nav>
    </main>
  );
}

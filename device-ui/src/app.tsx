import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { Notice } from "./types";
import { useCamera } from "./use-camera";
import { Icon } from "./icons";
import { Gallery, PhotoDetail } from "./gallery";
import { Settings } from "./settings";

export function App() {
  const { state, connected, act } = useCamera();
  const [screen, setScreen] = useState<
    "camera" | "gallery" | "photo" | "settings"
  >("camera");
  const [photoId, setPhotoId] = useState<string | null>(null);
  const [stylesOpen, setStylesOpen] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState("");
  const seenNotice = useRef(0);
  const lastCapture = useRef<string | null>(null);
  const booted = useRef("");
  const selectedStyle = useRef<HTMLButtonElement | null>(null);
  const report = useCallback((message: string) => setError(message), []);
  const openPhoto = useCallback((id: string) => {
    setPhotoId(id);
    setScreen("photo");
    setNotice(null);
  }, []);
  const camera = useCallback(() => setScreen("camera"), []);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(""), 7000);
    return () => clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    if (state.sessionId && booted.current !== state.sessionId) {
      booted.current = state.sessionId;
      lastCapture.current = state.lastCaptureId;
      seenNotice.current = state.notifications.at(-1)?.id || 0;
      return;
    }
    const latest = state.notifications.filter(
      (item) => item.id > seenNotice.current,
    );
    if (latest.length) {
      // Prefer a completion/failure over a simultaneous "photo saved" event.
      const event =
        [...latest]
          .reverse()
          .find((item) =>
            ["success", "error", "waiting"].includes(item.kind),
          ) || latest.at(-1)!;
      setNotice(event);
      seenNotice.current = latest.at(-1)!.id;
    }
    if (state.lastCaptureId && state.lastCaptureId !== lastCapture.current) {
      lastCapture.current = state.lastCaptureId;
      setScreen("camera");
    }
  }, [state.notifications, state.lastCaptureId, state.status, state.sessionId]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(
      () => setNotice(null),
      notice.kind === "queued" ? 2800 : 9000,
    );
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    selectedStyle.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [state.presetIndex, stylesOpen, screen]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName)
      )
        return;
      if (event.key === "Escape") {
        setScreen("camera");
        return;
      }
      if (screen !== "camera") return;
      const action =
        event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? "previous"
          : event.key === "ArrowRight" || event.key === "ArrowDown"
            ? "next"
            : event.key === " " || event.key === "Enter"
              ? "capture"
              : null;
      if (action) {
        event.preventDefault();
        void act(action).catch((error) => report(error.message));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, act, report]);
  const working = state.queued + (state.processingId ? 1 : 0);
  return (
    <main
      className="camera-shell"
      style={{ "--accent": state.preset.accent } as CSSProperties}
    >
      {screen === "camera" && (
        <section className="viewfinder" aria-label="Camera preview">
          <img
            key={state.sessionId}
            className="live-image"
            src="/preview.mjpg"
            alt="Live camera preview"
            draggable={false}
          />
          <div className="viewfinder-shade" />
          <header className="camera-header">
            <div className="brand">
              <Icon name="camera" size={24} />
              <strong>
                MUSE<span>CAM</span>
              </strong>
            </div>
            <div className="camera-status">
              <span
                className={
                  connected && state.status !== "error"
                    ? "status-dot"
                    : "status-dot offline"
                }
              />
              {!connected
                ? "Reconnecting"
                : state.status === "capturing"
                  ? "Capturing"
                  : state.maintenance
                    ? "Updating"
                    : state.status === "starting"
                      ? "Warming up"
                      : state.status === "error"
                        ? "Camera unavailable"
                      : !state.networkOnline && !state.simulate
                        ? "Saved offline"
                        : "Ready"}
              {state.battery !== null && (
                <span className="battery-status">
                  <Icon name="battery" size={18} />
                  {state.battery}%
                </span>
              )}
              {state.volume === 0 && <Icon name="mute" size={18} />}
            </div>
            <div className="header-actions">
              <button
                className="glass-button square"
                aria-label="Open gallery"
                onClick={() => setScreen("gallery")}
              >
                <Icon name="gallery" />
              </button>
              <button
                className="glass-button square"
                aria-label="Open settings"
                onClick={() => setScreen("settings")}
              >
                <Icon name="settings" />
              </button>
            </div>
          </header>
          <div className="focus-brackets" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          {stylesOpen && (
            <aside className="style-rail" aria-label="Choose a style">
              <div className="rail-heading">
                <span>IMAGINE IT AS</span>
                <button
                  aria-label="Hide styles"
                  onClick={() => setStylesOpen(false)}
                >
                  <Icon name="close" size={17} />
                </button>
              </div>
              <div className="rail-scroll">
                {state.presets.map((preset, index) => (
                  <button
                    ref={
                      preset.id === state.preset.id ? selectedStyle : undefined
                    }
                    key={preset.id}
                    className={
                      preset.id === state.preset.id
                        ? "rail-style selected"
                        : "rail-style"
                    }
                    aria-pressed={preset.id === state.preset.id}
                    onClick={() =>
                      void act("select", { presetId: preset.id }).catch(
                        (error) => report(error.message),
                      )
                    }
                  >
                    <span
                      className="style-number"
                      style={{ color: preset.accent }}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <strong>{preset.name}</strong>
                    {preset.id === state.preset.id && (
                      <span className="selected-mark" />
                    )}
                  </button>
                ))}
              </div>
            </aside>
          )}
          <footer className="camera-footer">
            <div className="current-style">
              <span className="eyebrow">Your next imagination</span>
              <strong>{state.preset.name}</strong>
              <span className="shutter-hint">
                {state.status === "live"
                  ? "Press the shutter to capture"
                  : state.status === "capturing"
                    ? "Hold steady"
                    : "Waiting for the camera"}
              </span>
            </div>
            {working > 0 && (
              <button
                className="queue-pill"
                onClick={() => setScreen("gallery")}
              >
                <span className="pulse-dot" />
                {state.processingId ? "Imagining" : "Waiting"} · {working}
                <Icon name="next" size={16} />
              </button>
            )}
            {!stylesOpen && (
              <button
                className="glass-button"
                onClick={() => setStylesOpen(true)}
              >
                <Icon name="spark" />
                Styles
              </button>
            )}
          </footer>
          {state.status === "capturing" && (
            <div className="shutter-flash" key={state.revision} />
          )}
          {(state.status === "starting" ||
            state.status === "error" ||
            state.status === "shutting_down") && (
            <div className="camera-overlay">
              <Icon name="camera" size={32} />
              <strong>
                {state.status === "starting"
                  ? "Waking up the camera"
                  : state.status === "shutting_down"
                    ? "Goodbye for now"
                    : "Camera needs attention"}
              </strong>
              <p>{state.message}</p>
              {state.status === "error" && (
                <button
                  className="glass-button"
                  disabled={!connected}
                  onClick={() =>
                    void act("restart_camera").catch((error) => report(error.message))
                  }
                >
                  Restart camera
                </button>
              )}
            </div>
          )}
        </section>
      )}
      {screen === "gallery" && (
        <Gallery
          state={state}
          onOpen={openPhoto}
          onCamera={camera}
          report={report}
        />
      )}
      {screen === "photo" && photoId && (
        <PhotoDetail
          key={photoId}
          id={photoId}
          state={state}
          act={act}
          onBack={() => setScreen("gallery")}
          onCamera={camera}
          report={report}
        />
      )}
      {screen === "settings" && (
        <Settings state={state} onCamera={camera} report={report} />
      )}
      {notice && screen !== "settings" && (
        <div className={`notice ${notice.kind}`} role="status">
          <button
            className="notice-content"
            onClick={() =>
              notice.captureId ? openPhoto(notice.captureId) : setNotice(null)
            }
          >
            {notice.captureId ? (
              <img
                src={`/api/gallery/${notice.captureId}/thumbnail?kind=${notice.kind === "success" ? "result" : "source"}`}
                alt=""
              />
            ) : (
              <Icon name="spark" />
            )}
            <span>
              <strong>{notice.title}</strong>
              <small>{notice.message}</small>
              {notice.captureId && <em>Tap to view</em>}
            </span>
          </button>
          <button
            className="notice-close"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss message" onClick={() => setError("")}>
            <Icon name="close" size={18} />
          </button>
        </div>
      )}
    </main>
  );
}

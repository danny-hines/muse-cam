import { useCallback, useEffect, useState } from "react";
import type { CameraAction, CameraState, Preset } from "./types";

const preset: Preset = {
  id: "starting",
  kind: "imagined",
  name: "Warming up",
  description: "Getting the camera ready",
  accent: "#ffac71",
};
const FALLBACK: CameraState = {
  view: { screen: "camera", photoId: null, versionId: null },
  focus: { supported: false, point: null, mode: "auto", status: "unavailable" },
  previewSize: { width: 800, height: 480 },
  status: "starting",
  preset,
  presets: [],
  presetIndex: 0,
  presetCount: 0,
  timerSeconds: 0,
  countdownRemaining: 0,
  message: "Starting camera",
  networkOnline: true,
  queued: 0,
  pendingRetractions: 0,
  processingId: null,
  sharingId: null,
  battery: null,
  galleryRevision: 0,
  galleryCount: 0,
  stylesOff: null,
  latestPhoto: null,
  notifications: [],
  lastCaptureId: null,
  volume: 35,
  processingSound: true,
  maintenance: false,
  canShare: true,
  canEdit: false,
  looks: [],
  simulate: false,
  revision: 0,
  sessionId: "",
};

export async function api<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    cache: "no-store",
    headers:
      body === undefined
        ? undefined
        : { "Content-Type": "application/json", "X-MuseCam-Request": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Camera connection interrupted. Try again.");
  return data as T;
}

export function useCamera() {
  const [state, setState] = useState(FALLBACK);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let active = true;
    // SSE sends the current state immediately and owns ordering after reconnect.
    const events = new EventSource("/api/events");
    events.onmessage = (event) => {
      if (!active) return;
      try {
        setState(JSON.parse(event.data) as CameraState);
        setConnected(true);
      } catch {
        setConnected(false);
      }
    };
    events.onerror = () => {
      if (active) setConnected(false);
    };
    return () => {
      active = false;
      events.close();
    };
  }, []);
  const act = useCallback(
    (action: CameraAction, values: object = {}) =>
      api<{ accepted: boolean }>(`/api/actions/${action}`, values),
    [],
  );
  return { state, connected, act };
}

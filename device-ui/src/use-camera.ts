import { useCallback, useEffect, useRef, useState } from "react";

import type { CameraAction, CameraState } from "./types";

const FALLBACK_STATE: CameraState = {
  status: "starting",
  preset: {
    id: "starting",
    name: "Warming up",
    description: "The camera is getting ready.",
    accent: "#d7ff42",
  },
  presetIndex: 0,
  presetCount: 1,
  message: "Starting camera",
  networkOnline: true,
  queued: 0,
  battery: null,
  shared: false,
  shareUrl: null,
  resultUrl: null,
  revision: 0,
};

export function useCamera() {
  const [state, setState] = useState<CameraState>(FALLBACK_STATE);
  const [connected, setConnected] = useState(false);
  const actionPending = useRef(false);

  useEffect(() => {
    let active = true;
    const loadState = async () => {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) throw new Error(`Camera returned ${response.status}`);
        const nextState = (await response.json()) as CameraState;
        if (active) {
          setState(nextState);
          setConnected(true);
        }
      } catch {
        if (active) setConnected(false);
      }
    };

    void loadState();
    const events = new EventSource("/api/events");
    events.onmessage = (event) => {
      if (!active) return;
      setState(JSON.parse(event.data) as CameraState);
      setConnected(true);
    };
    events.onerror = () => {
      if (active) setConnected(false);
    };
    return () => {
      active = false;
      events.close();
    };
  }, []);

  const act = useCallback(async (action: CameraAction) => {
    if (actionPending.current) return;
    actionPending.current = true;
    try {
      const response = await fetch(`/api/actions/${action}`, { method: "POST" });
      if (!response.ok) throw new Error(`Action returned ${response.status}`);
      setState((await response.json()) as CameraState);
      setConnected(true);
    } catch {
      setConnected(false);
    } finally {
      actionPending.current = false;
    }
  }, []);

  return { state, connected, act };
}
